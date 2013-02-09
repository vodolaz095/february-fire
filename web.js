
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
			$unset : {
				grabbedBy : null,
				touchedAt : null
			}
		}, p.set)
		p.get()

		db.collection('users').update({ _id : u._id }, { $unset : { grabbedTask : null }}, p.set)
		p.get()
	}

	app.all('/rpc', require('./rpc.js')({
		getUser : function (arg, req, res) {
			return req.user
		},

		getFeed : function (arg, req, res) {
			var p = _.promise()
			db.collection('records').ensureIndex({ touchedAt : -1 }, { background : true })
			db.collection('records').find({ touchedAt : { $exists : true }}).sort({ touchedAt : -1 }).limit(10, function (_, data) { p.set(data) })
			return p.get()
		},

		getAvailableTasks : function (arg, req, res) {
			var p = _.promise()
			var rand = _.md5('' + Math.random())
			var rands = _.shuffle([[{ $gte : rand }, { _id : 1 }], [{ $lte : rand }, { _id : -1 }]])
			db.collection('records').find({ _id : rands[0][0], availableToAnswerAt : { $lt : _.time() }}).sort(rands[0][1]).limit(10, function (err, data) { p.set(data) })
			var data = p.get()
			if (data.length > 0) return data
			db.collection('records').find({ _id : rands[1][0], availableToAnswerAt : { $lt : _.time() }}).sort(rands[1][1]).limit(10, function (err, data) { p.set(data) })
			var data = p.get()
			return data
		},

		grabTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"

			if (!arg.match(/^.{0,64}$/)) throw "bad input"

			ungrabTask(u)

			var p = _.promise()
			db.collection('records').update({
				_id : arg,
				availableToAnswerAt : { $lt : _.time() }
			}, {
				$set : {
					availableToAnswerAt : _.time() + 1000 * 60 * 60,
					grabbedBy : u._id,
					touchedAt : _.time()
				}
			}, p.set)
			p.get()

			db.collection('records').findOne({ _id : arg }, function (_, data) { p.set(data) })
			var rec = p.get()

			if (rec.grabbedBy == u._id) {
				db.collection('users').update({ _id : u._id }, { $set : { grabbedTask : rec._id }}, p.set)
				p.get()
				return rec
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
			if (!arg.answer.match(/^.{150,450}$/)) throw "bad input"
			// work here
			if (arg.url) {
				if (!arg.url.match(/^https?:\/\/.{2,1024}$/)) throw "bad input"
			}

			var p = _.promise()
			var now = _.time()
			db.collection('records').update({
				_id : arg.task,
				grabbedBy : u._id
			}, {
				$unset : {
					availableToAnswerAt : null,
					grabbedBy : null,
				},
				$set : {
					touchedAt : now,
					answer : arg.answer,
					url : arg.url,
					answeredBy : u._id,
					answeredAt : now,
					availableToReviewAt : 0
				}
			}, p.set)
			p.get()

			db.collection('records').findOne({ _id : arg.task, answeredBy : u._id }, function (_, data) { p.set(data) })
			if (p.get()) {
				db.collection('users').update({ _id : u._id }, { $inc : { answerCount : 1 }}, p.set)
				p.get()
				return true
			} else {
				return false
			}
		}
	}))

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})
})
