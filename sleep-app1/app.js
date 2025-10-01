var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
require('./lib/database');

// ★あなたが作ったroutes/index.jsを読み込む
var indexRouter = require('./routes/index');var authRouter = require('./routes/auth');
var settingsRouter = require('./routes/settings');
var alarmsRouter = require('./routes/alarms');

var app = express();

// view engine setup (EJSを使うための設定)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ミドルウェアの設定 (Expressが便利に動くための設定)
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// ★ publicフォルダを外部からアクセス可能にする設定
app.use(express.static(path.join(__dirname, 'public')));

// ルーティング設定 (URLとプログラムを結びつける)
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/settings', settingsRouter);
app.use('/alarms', alarmsRouter);

// catch 404 and forward to error handler (ページが見つからない時の処理)
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler (エラーが発生した時の処理)
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error'); // views/error.ejs を表示
});

module.exports = app;