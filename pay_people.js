
function logError(err, notes) {
	if (typeof(err) == 'object')
    	console.log('error: ' + (err.stack || _.json(err, true)))
    else
    	console.log('error: ' + err)
	console.log('notes: ' + notes)
}

process.on('uncaughtException', function (err) {
    try {
    	console.log("PAYMENT ERROR!")
		logError(err)
		process.exit(1)
	} catch (e) {}
})

function getAll(o, path, params) {
	var kind = path.match(/([^\/]+)s(\?|$)/)[1]
	var kinds = kind + 's'
	if (!params) params = {}

	var accum = []
	var offset = 0
	var pageSize = 100
	var p = _.promiseErr()
	while (true) {
		params.page = offset + ';' + pageSize
		o.get(path, params, p.set)
		var a = p.get()[kinds]
		var b = a[kind]
		if (b) {
			if (b instanceof Array)
				accum.push(b)
			else
				accum.push([b])
		} else {
			break
		}
		offset += pageSize
		if (offset >= a.lister.total_count)
			break
	}
	return [].concat.apply([], accum)
}

require('./u.js')
require('./nodeutil.js')
_.run(function () {

	var teams = _.makeSet(process.env.TEAMS.split(','))

	var mongojs = require('mongojs')
	console.log("connecting to db: " + process.env.MONGOHQ_URL)
	var db = mongojs.connect(process.env.MONGOHQ_URL)
	var p = _.promiseErr()

	var userStats = {}
	function addStat(userid, stat, amount) {
		_.bagAdd(_.ensure(userStats, userid, {}), stat, amount)
	}

	var count = 0
	db.collection('records').find({}).forEach(function (err, doc) {
		if (err || !doc) return p.set(err, doc)

		// work here
		count++
		if (count % 100 == 0)
			console.log("count: " + count)

		if (doc.reviewedBy) {
			addStat(doc.reviewedBy, 'reviewAcceptCount')
			addStat(doc.answeredBy, 'answerAcceptedCount')
		} else if (doc.answeredBy) {
			addStat(doc.answeredBy, 'answerPendingCount')
		}
		_.each(doc.history, function (h) {
			if (h.reviewedBy) {
				// note: h.reviewAccept is a hack,
				// it is only set when a reviewer reviewed their own work,
				// before that sort of thing was prevented,
				// but we still want to pay them for their review,
				// since we said we would,
				// but we still want someone else to review their work
				// before we mark it as an accepted answer
				addStat(h.reviewedBy, h.reviewAccept ? 'reviewAcceptCount' : 'reviewRejectCount')
				if (!h.reviewAccept) {
					addStat(h.answeredBy, 'answerRejectedCount')
					_.ensure(userStats, h.answeredBy, 'rejects', []).push({
						question : doc.question,
						answer : h.answer,
						url : h.url,
						answeredAt : h.answeredAt,
						reviewedBy : h.reviewedBy,
						reviewedAt : h.reviewedAt,
						reviewReason : h.reviewReason
					})
				}
			}
		})
	})
	p.get()

	var odesk = require('node-odesk')
	var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)

	db.collection('users').findOne({ _id : process.env.PAYER }, p.set)
	var payer = p.get()
	o.OAuth.accessToken = payer.accessToken
	o.OAuth.accessTokenSecret = payer.accessTokenSecret

	// work here
	console.log("got here 1")

	_.each(userStats, function (u, _id) {

		// work here
		if (_id != 'hopec1972') return

		// work here
		console.log("got here 2")


		u.deservedCents = (u.answerAcceptedCount || 0) * 28 + (u.reviewAcceptCount || 0) * 4

		db.collection('users').findOne({ _id : _id }, p.set)
		var user = p.get()

		var payCents = u.deservedCents - _.ensure(user, 'paidCents', 0)
		if (payCents >= 50) {
			// find the engagement
			if (!user.engagement && user.ref) {

				// work here
				console.log("got here 3")

				var es = getAll(o, 'hr/v2/engagements', { provider__reference : user.ref, status : "active" })
				var e = _.find(es, function (e) { return _.has(teams, e.buyer_team__reference) })
				if (e) {
					user.engagement = e.reference
					user.engagementTeam = e.buyer_team__reference
					user.engagementTeamName = e.buyer_team__name
				}
			}

			if (user.engagement) {
				// start payment process
				var payment = {
					_id : mongojs.ObjectId(),
					user : _id,
					payCents : payCents,
					startedAt : _.time()
				}
				db.collection('payments').insert(payment, p.set)
				p.get()

				// actually pay them


				// work here
				var x = {
					engagement__reference : user.engagement,
					amount : payCents / 100,
					comments : 'payment for mocska. thanks!'
				}
				console.log("x = " + _.json(x, true))


				o.post('hr/v2/teams/' + user.engagementTeam + '/adjustments', {
					engagement__reference : user.engagement,
					amount : payCents / 100,
					comments : 'payment for mocska. thanks!'
				}, p.set)
				var adjustment = p.get().adjustment
				if (!adjustment) throw new Error('failed payment')

				// end payment process
				db.collection('users').update({ _id : _id }, {
					$inc : { paidCents : payCents },
					$set : {
						engagement : user.engagement,
						engagementTeam : user.engagementTeam
					}
				}, p.set)
				p.get()

				db.collection('payments').update({ _id : payment._id }, { $set : { endedAt : _.time(), adjustment : adjustment } }, p.set)
				p.get()

				// work here
				throw new Error('test error: just paid: ' + _id)
			}
		}

		if (u.rejects) {
			var rejects = u.rejects
			delete u.rejects
			rejects.sort(function (a, b) { return b.answeredAt - a.answeredAt })
			db.collection('rejects').update({ _id : _id }, {
				$set : { rejects : rejects }
			}, { upsert : true }, p.set)
			p.get()
		}

		db.collection('users').update({ _id : _id }, {
			$set : { stats : u }
		}, p.set)
		p.get()
	})

	process.exit(1)
})
