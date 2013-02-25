
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

	function csv(data) {
	    var s = []
	    function escapeCsv(s) {
	        if (s.match(/[,"]/))
	            return '"' + s.replace(/"/g, '""') + '"'
	        return s
	    }
	    function escapeLine(a) {
	        return _.map(_.values(a), escapeCsv).join(',')
	    }
	    s.push(escapeLine(_.keys(data[0])))
	    _.each(data, function (row) {
	        s.push(escapeLine(row))
	    })
	    return s.join('\n')
	}

	var db = require('mongojs').connect(process.env.MONGOHQ_URL)
	var p = _.promiseErr()

	db.collection('users').find({}, p.set)
	var users = p.get()

	function getName(id) {
		return _.find(users, function (u) { return u._id == id }).name
	}

	var accum = []
	db.collection('records').find({ 'history.reviewedBy' : { $exists : true } }).forEach(function (err, doc) {
		if (err || !doc) return p.set(err, doc)

		_.each(doc.history, function (h) {
			if (h.reviewedBy && !h.reviewAccept) {
				accum.push({
					authorName : getName(h.answeredBy) || "",
					question : doc.question || "",
					answer : h.answer || "",
					url : h.url || "",
					editorName : getName(h.reviewedBy) || "",
					rejectionReason : h.reviewReason || ""
				})

				console.log("..: " + _.json(accum[accum.length - 1]))

			}
		})

	})
	p.get()

	console.log("got here?")
	try {
		_.save('./_rejections.csv', csv(accum))
	} catch (e) {
		console.log("ee: " + e)
	}

	_.print(count)
	_.exit()

})
