
function logError(err, notes) {
    console.log('error: ' + (err.stack || err))
	console.log('notes: ' + notes)
}

process.on('uncaughtException', function (err) {
    try {
		logError(err)
	} catch (e) {}
})

require('./u.js')
require('./nodeutil.js')
_.run(function () {

	var db = require('mongojs').connect(process.env.MONGOHQ_URL, ['records'])

	db.createCollection('logs', {capped : true, size : 10000}, function () {})
	logError = function (err, notes) {
	    console.log('error: ' + (err.stack || err))
		console.log('notes: ' + _.json(notes))
		db.collection('logs').insert({ error : '' + (err.stack || err), notes : notes })
	}

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
		cookie : { maxAge : 24 * 60 * 60 * 1000 },
		store : new MongoStore({
			url : process.env.MONGOHQ_URL,
			auto_reconnect : true,
			clear_interval : 3600
		})
	}))

	require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET, process.env.PAYER)

	app.get('/', function (req, res) {
		res.sendfile('./index.html')
	})

	app.get('/loadtest', function (req, res) {
		_.run(function () {
			res.send('response: ' + _.json(getAvailableTasks('availableToAnswerAt', req.user), true))
		})
	})

	app.get('/error', function (req, res) {
		throw "test error"
	})

	require('./csv.js')
    app.get('/csv', function (req, res) {
    	_.run(function () {
	        var batch = req.query.batch
	        if (!batch) throw new Error("please specify a batch")       
	        var begin = req.query.begin ? new Date(req.query.begin + " UTC").getTime() : 0
	        var end = req.query.end ? new Date(req.query.end + " UTC").getTime() + (1000 * 60 * 60 * 24) : Number.MAX_VALUE

	        var p = _.promiseErr()
	        var cur = db.records.find({ batch : batch, doneAt : { $gte : begin, $lt : end } })

            res.writeHead(200, {
                'Content-Type' : 'text/csv; charset=utf-8',
                'Content-disposition' : 'attachment; filename=batch' + '_' + batch + (req.query.begin ? '_from_' + req.query.begin : '') + (req.query.end ? '_through_' + req.query.end : '') + '.csv'
            })
            res.write(_.csvLine(['QUESTION', 'CATEGORY', 'ANSWER', 'URL']) + '\n')
	        cur.on('data', function (r) {
	        	if (r.rejectedBy) {
	        		res.write(_.csvLine([
	        			r.question,
	        			r.category,
	        			'BAD QUESTION',
	        			r.rejectReason
        			]) + '\n')
	        	} else {
	        		res.write(_.csvLine([
	        			r.question,
	        			r.category,
	        			r.answer,
	        			r.url
        			]) + '\n')
	        	}
	        })
	        cur.on('end', function () {
	        	res.end()
	        })
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
		db.collection('records').ensureIndex({ grabbedBy : 1 }, { background : true })

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

		db.collection('records').ensureIndex(_.unPairs([[lockColumn, 1], ['_id', 1]]))
		db.collection('records').ensureIndex(_.unPairs([[lockColumn, 1], ['_id', -1]]))

		var rand = _.md5('' + Math.random())
		var rands = _.shuffle([[{ $gte : rand }, { _id : 1 }], [{ $lte : rand }, { _id : -1 }]])

		var q = { _id : rands[0][0] }
		q[lockColumn] = { $lt : _.time() }
		if (u) q.ban = { $nin : [ u._id ] }
		db.collection('records').find(q).sort(_.extend(_.unPairs([[lockColumn, 1]]), rands[0][1])).limit(10, p.set)
		var data = p.get()

		if (data.length > 0) return data

		var q = { _id : rands[1][0] }
		q[lockColumn] = { $lt : _.time() }
		if (u) q.ban = { $nin : [ u._id ] }
		db.collection('records').find(q).sort(_.extend(_.unPairs([[lockColumn, 1]]), rands[1][1])).limit(10, p.set)
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
			if (!u) throw new Error("must be logged in")
			if (!arg.match(/^.{0,64}$/)) throw new Error("bad input: " + arg)

			return grabTask(u, arg, 'availableToAnswerAt')
		},

		ungrabTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")

			return ungrabTask(u, 'availableToAnswerAt')
		},

		grabReviewTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")
			if (!arg.match(/^.{0,64}$/)) throw new Error("bad input: " + arg)
			if (!_.has(editors, u._id)) throw new Error("access denied")

			return grabTask(u, arg, 'availableToReviewAt')
		},

		ungrabReviewTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")

			return ungrabTask(u, 'availableToReviewAt')
		},

		submitTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")
			if (!arg.task.match(/^.{0,64}$/)) throw new Error("bad input: " + arg.task)
			if (!arg.answer.match(/^[\S\s]{150,450}$/)) throw new Error("bad input: " + arg.answer)
			if (arg.url) {
				if (!arg.url.match(/^https?:\/\/.{2,1024}$/)) throw new Error("bad input: " + arg.url)
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
				db.collection('users').update({ _id : u._id }, {
					$inc : { answerCount : 1 },
					$unset : { grabbedTask : null, taskType : null }
				}, p.set)
				p.get()
				return true
			}
		},

		rejectQuestion : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")
			if (!arg.task.match(/^.{0,64}$/)) throw new Error("bad input: " + arg.task)
			if (!arg.reason.match(/^[\S\s]{1,1024}$/)) throw new Error("bad input: " + arg.answer)

			var now = _.time()
			if (submitTask(u, arg.task, 'availableToAnswerAt', {
				$set : {
					rejectReason : arg.reason,
					rejectedBy : u._id,
					rejectedAt : now,
					doneAt : now
				},
				$push : { ban : u._id }
			})) {
				var p = dbPromise()
				db.collection('users').update({ _id : u._id }, {
					$unset : { grabbedTask : null, taskType : null }
				}, p.set)
				p.get()
				return true
			}
		},

		submitReviewTask : function (arg, req, res) {
			var u = req.user
			if (!u) throw new Error("must be logged in")
			if (!arg.task.match(/^.{0,64}$/)) throw new Error("bad input: " + arg.task)
			arg.accept = !!arg.accept
			if (arg.accept) {
				if (!arg.answer.match(/^[\S\s]{150,450}$/)) throw new Error("bad input: " + arg.answer)
				if (arg.url) {
					if (!arg.url.match(/^https?:\/\/.{2,1024}$/)) throw new Error("bad input: " + arg.url)
				}
			} else {
				// if (!(arg.reason.length > 0)) throw new Error("bad input: " + arg.reason)
			}

			var p = dbPromise()
			db.collection('records').findOne({ _id : arg.task }, p.set)
			var oldTask = p.get()

			if (arg.accept) {
				var now = _.time()
				var done = submitTask(u, arg.task, 'availableToReviewAt', { 
					$set : {
						answer : arg.answer,
						url : arg.url,
						reviewedBy : u._id,
						reviewedAt : now,
						doneAt : now
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
						answeredAt : null
					},
					$set : {
						availableToAnswerAt : 0
					},
					$push : {
						history : {
							answer : oldTask.answer,
							url : oldTask.url,
							answeredBy : oldTask.answeredBy,
							answeredAt : oldTask.answeredAt,
							reviewedBy : u._id,
							reviewedAt : _.time(),
							reviewReason : arg.reason
						}
					}
				})
			}
			if (done) {
				db.collection('users').update({ _id : u._id }, {
					$inc : { reviewCount : 1 },
					$unset : { grabbedTask : null, taskType : null }
				}, p.set)
				p.get()
				return true
			}
		}
	}))

	app.use(function(err, req, res, next) {
		logError(err, {
			session : req.session,
			user : req.user
		})
		next(err)
	})

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})

})
