
require('./u.js')
require('./nodeutil.js')
_.run(function () {

	var db = require('mongojs').connect(process.env.MONGOHQ_URL)

	var express = require('express')
	var app = express.createServer()

	app.use(express.cookieParser())
	app.use(function (req, res, next) {
		_.run(function () {
			req.body = _.consume(req)
		    next()
		})
	})

	var MongoStore = require('connect-mongo')(express)
	app.use(express.session({
		secret : process.env.SESSION_SECRET,
		store : new MongoStore({
			url : process.env.MONGOHQ_URL
		})
	}))

	require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)

	app.get('/', function(req, res) {
		res.sendfile('./index.html')
	})

	function ungrabTask(u) {
		var p = _.promise()
		db.collection('records').update({
			grabbedBy : u._id
		}, {
			$set : { availableToAnswerAt : 0 },
			$unset : { grabbedBy : null }
		}, p.set)
		p.get()
	}

	function tryToGrabTask(u, task) {
		var p = _.promise()
		db.collection('records').update({
			_id : task,
			availableToAnswerAt : { $lt : _.time() }
		}, {
			$set : {
				availableToAnswerAt : _.time() + 1000 * 60 * 60,
				grabbedBy : u._id
			}
		}, p.set)
		p.get()
	}

	app.all('/rpc', require('./rpc.js')({
		getUser : function (arg, req, res) {
			return req.user
		},

		getAvailableTasks : function (arg, req, res) {
			var p = _.promise()
			db.collection('records').find({ availableToAnswerAt : { $lt : _.time() }}).limit(10, function (err, data) { p.set(data) })
			var data = p.get()
			return data
		},

		grabTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"

			if (!arg.match(/^.{0,64}$/)) throw "bad input"

			ungrabTask(u)
			tryToGrabTask(u, arg)

			var p = _.promise()
			db.collection('records').findOne({ _id : arg }, function (_, data) { p.set(data) })
			var rec = p.get()

			if (rec.grabbedBy == u._id) {
				db.collection('users').update({ _id : u._id }, { $set : { grabbedTask : rec._id }}, p.set)
				p.get()
				return rec
			} else {
				db.collection('users').update({ _id : u._id }, { $unset : { grabbedTask : null }}, p.set)
				p.get()
			}
		},

		ungrabTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"

			ungrabTask(u)
		},

		submitTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"

			if (!arg.task.match(/^.{0,64}$/)) throw "bad input"
			if (!arg.answer.match(/^.{2,1024}$/)) throw "bad input"

			var p = _.promise()
			db.collection('records').update({
				_id : arg.task,
				grabbedBy : u._id
			}, {
				$unset : {
					availableToAnswerAt : null,
					grabbedBy : null,
				},
				$set : {
					answer : arg.answer,
					answeredBy : u._id,
					answeredAt : _.time(),
					availableToReviewAt : 0
				}
			}, p.set)
			p.get()

			db.collection('records').findOne({ _id : arg.task, answeredBy : u._id }, function (_, data) { p.set(data) })
			return !!p.get()
		}
	}))

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})
})
