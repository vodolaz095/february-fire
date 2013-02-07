
require('./u.js')

var db = require('mongojs').connect(process.env.MONGOHQ_URL)

var express = require('express')
var app = express.createServer()

app.use(express.cookieParser())
app.use(express.bodyParser())
app.use(express.session({ secret : process.env.SESSION_SECRET }))
require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)

app.get('/', function(req, res) {
  	res.send('Hello2: ' + _.escapeXml("" + _.json(req.user, true)))
})

app.listen(process.env.PORT, function() {
	console.log("go to " + process.env.HOST)
})
