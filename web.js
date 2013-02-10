
process.on('uncaughtException', function (err) {
    console.log('uncaught exception: ' + (err.stack || err))
})

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

	app.get('/', function (req, res) {
		res.sendfile('./index.html')
	})

	app.get('/loadtest', function (req, res) {
		_.run(function () {
			res.send('response: ' + _.json(getAvailableTasks('availableToAnswerAt', req.user), true))
		})
	})
	
	var editors = _.makeSet(process.env.EDITORS.split(/,/))

	function dbPromise() {
		var p = _.promise()
		return {
			set : function (err, data) {
				p.set([err, data])
			},
			get : function () {
				var x = p.get()
				if (x[0]) throw x[0]
				return x[1]
			}
		}
	}

	function ungrabTask(u, lockColumn) {
		var pre = {}
		pre.grabbedBy = u._id
		pre[lockColumn] = { $ne : null }

		var post = {}
		post.$unset = { grabbedBy : null }
		post.$set = {}
		post.$set[lockColumn] = 0
		post.$set.touchedAt = _.time()

		var p = dbPromise()
		db.collection('records').update(pre, post, p.set)
		p.get()

		db.collection('users').update({ _id : u._id }, { $unset : { grabbedTask : null, taskType : null }}, p.set)
		p.get()
	}

	function grabTask(u, task, lockColumn) {
		ungrabTask(u, lockColumn)

		var pre = {}
		pre._id = task
		pre[lockColumn] = { $lt : _.time() }
		pre.ban = { $nin : [ u._id ] }

		var post = {}
		post.$set = {}
		post.$set[lockColumn] = _.time() + 1000 * 60 * 60
		post.$set.grabbedBy = u._id
		post.$set.touchedAt = _.time()

		var p = dbPromise()
		db.collection('records').findAndModify({ query : pre, update : post, 'new' : true}, p.set)
		task = p.get()
		if (task) {
			db.collection('users').update({ _id : u._id }, { $set : { grabbedTask : task._id, taskType : lockColumn }}, p.set)
			p.get()
			return task
		}
	}

	function submitTask(u, task, lockColumn, post) {
		var pre = {
			_id : task,
			grabbedBy : u._id
		}
		pre[lockColumn] = { $ne : null }

		var $unset = _.ensure(post, '$unset', {})
		$unset.grabbedBy = null
		$unset[lockColumn] = null

		var $set = _.ensure(post, '$set', {})
		$set.touchedAt = _.time()

		var p = dbPromise()
		db.collection('records').findAndModify({ query : pre, update : post}, p.set)
		return p.get()
	}

	function getAvailableTasks(lockColumn, u) {
		var p = dbPromise()

		var rand = _.md5('' + Math.random())
		var rands = _.shuffle([[{ $gte : rand }, { _id : 1 }], [{ $lte : rand }, { _id : -1 }]])

		var q = { _id : rands[0][0] }
		q[lockColumn] = { $lt : _.time() }
		if (u) q.ban = { $nin : [ u._id ] }
		db.collection('records').find(q).sort(rands[0][1]).limit(10, p.set)
		var data = p.get()

		if (data.length > 0) return data

		var q = { _id : rands[1][0] }
		q[lockColumn] = { $lt : _.time() }
		if (u) q.ban = { $nin : [ u._id ] }
		db.collection('records').find(q).sort(rands[1][1]).limit(10, p.set)
		var data = p.get()

		return data
	}

	app.all('/rpc', require('./rpc.js')({
		getVersion : function () {
			return 1
		},

		getUser : function (arg, req, res) {
			var u = req.user
			if (u) {
				if (_.has(editors, u._id)) {
					u.editor = true
				}
				return u
			}
		},

		getFeed : function (arg, req, res) {
			var p = dbPromise()
			db.collection('records').ensureIndex({ touchedAt : -1 }, { background : true })
			db.collection('records').find({ touchedAt : { $exists : true }}).sort({ touchedAt : -1 }).limit(10, p.set)
			return p.get()
		},

		getAvailableTasks : function (arg, req, res) {
			return getAvailableTasks('availableToAnswerAt', req.user)
		},

		getAvailableReviewTasks : function (arg, req, res) {
			return getAvailableTasks('availableToReviewAt', req.user)
		},

		grabTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"
			if (!arg.match(/^.{0,64}$/)) throw "bad input"

			return grabTask(u, arg, 'availableToAnswerAt')
		},

		ungrabTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"

			return ungrabTask(u, 'availableToAnswerAt')
		},

		grabReviewTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"
			if (!arg.match(/^.{0,64}$/)) throw "bad input"
			if (!_.has(editors, u._id)) throw "access denied"

			return grabTask(u, arg, 'availableToReviewAt')
		},

		ungrabReviewTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"

			return ungrabTask(u, 'availableToReviewAt')
		},

		submitTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"
			if (!arg.task.match(/^.{0,64}$/)) throw "bad input"
			if (!arg.answer.match(/^.{150,450}$/)) throw "bad input"
			if (arg.url) {
				if (!arg.url.match(/^https?:\/\/.{2,1024}$/)) throw "bad input"
			}

			if (submitTask(u, arg.task, 'availableToAnswerAt', {
				$set : {
					answer : arg.answer,
					url : arg.url,
					answeredBy : u._id,
					answeredAt : _.time(),
					availableToReviewAt : 0
				},
				$push : { ban : u._id }
			})) {
				var p = dbPromise()
				db.collection('users').update({ _id : u._id }, { $inc : { answerCount : 1 }}, p.set)
				p.get()
				return true
			}
		},

		submitReviewTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw "must be logged in"
			if (!arg.task.match(/^.{0,64}$/)) throw "bad input"
			arg.accept = !!arg.accept
			if (arg.accept) {
				if (!arg.answer.match(/^.{150,450}$/)) throw "bad input"
				if (arg.url) {
					if (!arg.url.match(/^https?:\/\/.{2,1024}$/)) throw "bad input"
				}
			}

			var p = dbPromise()
			db.collection('records').findOne({ _id : arg.task }, p.set)
			var oldTask = p.get()

			if (arg.accept) {
				var done = submitTask(u, arg.task, 'availableToReviewAt', { 
					$set : {
						answer : arg.answer,
						url : arg.url,
						reviewedBy : u._id,
						reviewedAt : _.time()
					},
					$push : {
						history : {
							answer : oldTask.answer,
							url : oldTask.url
						}
					}
				})
			} else {
				var done = submitTask(u, arg.task, 'availableToReviewAt', {
					$unset : {
						answer : null,
						url : null,
						answeredBy : null,
						answeredAt : null,
						availableToAnswerAt : 0
					},
					$push : {
						history : {
							answer : oldTask.answer,
							url : oldTask.url,
							answeredBy : oldTask.answeredBy,
							answeredAt : oldTask.answeredAt,
							reviewedBy : u._id,
							reviewedAt : _.time()
						}
					}
				})
			}
			if (done) {
				db.collection('users').update({ _id : u._id }, { $inc : { reviewCount : 1 }}, p.set)
				p.get()
				return true
			}
		}
	}))

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})
	
})
