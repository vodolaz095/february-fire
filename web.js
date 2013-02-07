
require('./u.js')

var db = require('mongojs').connect(process.env.MONGOHQ_URL)

var passport = require('passport')
var OAuthStrategy = require('passport-oauth').OAuthStrategy;

passport.use('oDesk', new OAuthStrategy({
    requestTokenURL: 'https://www.odesk.com/api/auth/v1/oauth/token/request',
    accessTokenURL: 'https://www.odesk.com/api/auth/v1/oauth/token/access',
    userAuthorizationURL: 'https://www.odesk.com/services/api/auth',
    consumerKey: process.env.ODESK_API_KEY,
    consumerSecret: process.env.ODESK_API_SECRET,
    callbackURL: process.env.HOST + '/login-callback'
}, function(token, tokenSecret, profile, done) {
	var odesk = require('node-odesk')
	var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
	o.OAuth.accessToken = token;
	o.OAuth.accessTokenSecret = tokenSecret;  	
	o.get('auth/v1/info', function(error, data) {
		if (error) return done(error)
	    var user = {
	    	_id : data.auth_user.uid,
	    	name : data.auth_user.first_name + " " + data.auth_user.last_name,
	    	img : data.info.portrait_100_img,
	    	country : data.info.location.country,
	    	profile : data.info.profile_url
	    }
	    db.collection('user').update({ _id : user._id }, user, { upsert : true }, function (err) {
	    	if (err) return done(error)
    		done(null, user)
	    })
	})
}))

passport.serializeUser(function (user, done) {
	done(null, user._id)
})

passport.deserializeUser(function (id, done) {
	db.collection('user').findOne({ _id : id }, function (err, data) {
		if (err) return done(err)
		done(null, data)
	})
})

var express = require('express')
var app = express.createServer()

app.use(express.cookieParser())
app.use(express.bodyParser())
app.use(express.session({ secret : process.env.SESSION_SECRET }))
app.use(passport.initialize())
app.use(passport.session())

app.get('/login', passport.authenticate('oDesk'))
app.get('/login-callback', passport.authenticate('oDesk', {
	successRedirect: '/',
	failureRedirect: '/login'
}))

app.get('/', function(req, res) {
  	res.send('Hello: ' + _.escapeXml("" + _.json(req.user, true)))
})

app.listen(process.env.PORT, function() {
	console.log("go to " + process.env.HOST)
})
