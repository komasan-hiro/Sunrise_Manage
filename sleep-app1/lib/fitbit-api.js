const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
const tokensPath = path.join(__dirname, '..', 'fitbit-tokens.json');

// --- PKCE Code Generator ---
function base64URLEncode(str) {
    return str.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}
function generateCodeChallenge(verifier) {
  return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}

// --- Token Management ---
function saveTokens(tokens) {
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');
}
function loadTokens() {
  if (fs.existsSync(tokensPath)) {
    return JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  }
  return null;
}

/** 認可ページのURLを生成 */
function getAuthorizationUrl() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  fs.writeFileSync(path.join(__dirname, '..', 'pkce-verifier.txt'), codeVerifier);

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: 'sleep heartrate',
    redirect_uri: process.env.REDIRECT_URL,
  });
  return `https://www.fitbit.com/oauth2/authorize?${params.toString()}`;
}

/** 認可コードを使ってトークンを取得 */
async function fetchTokens(code) {
  const codeVerifier = fs.readFileSync(path.join(__dirname, '..', 'pkce-verifier.txt'), 'utf8');
  const credentials = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');
  
  const body = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    code_verifier: codeVerifier,
    redirect_uri: process.env.REDIRECT_URL,
  });

  try {
    const response = await axios.post('https://api.fitbit.com/oauth2/token', body.toString(), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    saveTokens(response.data);
    console.log('トークンを正常に取得・保存しました。');
    return response.data;
  } catch (error) {
    console.error('トークン取得エラー:', error.response?.data);
    throw error;
  }
}

/** トークンをリフレッシュ */
async function refreshTokens() {
  const currentTokens = loadTokens();
  if (!currentTokens) throw new Error('No tokens to refresh.');
  
  const credentials = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentTokens.refresh_token,
  });

  try {
    const response = await axios.post('https://api.fitbit.com/oauth2/token', body.toString(), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    saveTokens(response.data);
    console.log('トークンを正常にリフレッシュしました。');
    return response.data;
  } catch (error) {
    console.error('トークンリフレッシュエラー:', error.response?.data);
    throw error;
  }
}

/** APIリクエストを実行 (トークン管理を自動化) */
async function makeApiRequest(apiCall) {
  let tokens = loadTokens();
  if (!tokens) throw new Error('Not authenticated. Please authorize first.');
  
  try {
    return await apiCall(tokens.access_token);
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('アクセストークンが期限切れです。リフレッシュします...');
      tokens = await refreshTokens();
      return await apiCall(tokens.access_token);
    }
    throw error;
  }
}

/** 睡眠データを取得 */
async function getSleepData(date) {
  return makeApiRequest(async (accessToken) => {
    const url = `https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`;
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (response.data.sleep && response.data.sleep.length > 0) {
      const mainSleep = response.data.sleep.find(log => log.isMainSleep) || response.data.sleep[0];
      return mainSleep;
    }
    return null;
  });
}

/**
 * ★★★ 新規追加 ★★★
 * 現在に近い睡眠状態を取得する関数
 * @returns {Promise<string|null>} 最新の睡眠レベル ("wake", "rem", "light", "deep")
 */
async function getCurrentSleepState() {
  return makeApiRequest(async (accessToken) => {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.fitbit.com/1.2/user/-/sleep/date/${today}.json`;
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (response.data.sleep && response.data.sleep.length > 0) {
      const mainSleep = response.data.sleep.find(log => log.isMainSleep) || response.data.sleep[0];
      // 睡眠データの中から、一番最後のステージを取得
      const lastStage = mainSleep.levels?.data?.slice(-1)[0];
      if (lastStage) {
        const stageTime = new Date(lastStage.dateTime);
        // 最後の記録が30分以内なら、それを現在の状態とみなす
        if (new Date() - stageTime < 30 * 60 * 1000) {
          console.log('最新の睡眠状態:', lastStage.level);
          return lastStage.level;
        }
      }
    }
    console.log('最新の睡眠状態データが見つからないか、古すぎます。');
    return null;
  });
}


module.exports = {
  loadTokens,
  getAuthorizationUrl,
  fetchTokens,
  getSleepData,
  getCurrentSleepState // ★追加
};