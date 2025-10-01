var express = require('express');
var router = express.Router();
const fitbit = require('../lib/fitbit-api');

// ユーザーをFitbitの認可ページにリダイレクトさせる
router.get('/', (req, res, next) => {
  const authUrl = fitbit.getAuthorizationUrl();
  res.redirect(authUrl);
});

// Fitbitからのリダイレクトを受け取り、トークンを取得する
router.get('/callback', async (req, res, next) => {
  const code = req.query.code;
  console.log('Callback received with code:', code);
  if (!code) {
    return res.status(400).send('Error: Authorization code not found.');
  }
  try {
    console.log('Fetching tokens...');
    await fitbit.fetchTokens(code);
    console.log('Tokens fetched successfully. Redirecting to home...');
    // 成功したらトップページに戻る
    res.redirect('/');
  } catch (error) {
    console.error('Error in callback route:', error); 
    res.status(500).send('Failed to fetch tokens.');
  }
});

module.exports = router;