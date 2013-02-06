
require('./u.js')

var db = require('mongojs').connect(process.env.MONGOHQ_URL || "test")
var app = require('express').createServer()



// var odesk = require('node-odesk')
// var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)


var passport = require('passport')
var OAuthStrategy = require('passport-oauth').OAuthStrategy;

passport.use('oDesk', new OAuthStrategy({
    requestTokenURL: 'https://www.odesk.com/api/auth/v1/oauth/token/request',
    accessTokenURL: 'https://www.odesk.com/api/auth/v1/oauth/token/access',
    userAuthorizationURL: 'https://www.odesk.com/services/api/auth',
    consumerKey: process.env.ODESK_API_KEY,
    consumerSecret: process.env.ODESK_API_SECRET,
    callbackURL: 'https://sheltered-hamlet-7258.herokuapp.com/odesk-login-callback'
  },
  function(token, tokenSecret, profile, done) {
  	done(null, { "name" : "hi" })
    // User.findOrCreate(..., function(err, user) {
    //   done(err, user);
    // });
  }
));


app.all('/login',
  passport.authenticate('oDesk', { successRedirect: '/',
                                   failureRedirect: '/login' }));

app.get('/', function(request, response) {
	// db.collection("test").find(function (err, data) {
	// 	console.log("hi: " + _.json(data))
	// })
	console.log("hi?")
  	response.send('Hello World!')
})

// app.get('/login', function (req, res) {
// 	o.OAuth.getAuthorizeUrl('https://sheltered-hamlet-7258.herokuapp.com/odesk-login-callback', function(error, url, requestToken, requestTokenSecret) {
// 		res.redirect(url)
// 	})
// })

// app.get('/odesk-login-callback', function (req, res) {
// 	res.send("got here!")
// })

var port = process.env.PORT || 5000
app.listen(port, function() {
	console.log("Listening on " + port)
})
