require('./u.js')
require('./nodeutil.js')
_.run(function () {

	var fs = require('fs')
	var csv = require('csv')

	var lines = []
	var p = _.promise()
	csv().from.stream(fs.createReadStream('./_some_data.csv')).on('record', function (data, i) {
		lines.push(data)
	}).on('end', function () { p.set() })
	p.get()

	var records = _.map(lines, function (data) {
		var record = {
			question : data[0],
			category : data[2],
		}
		record._id = _.md5(record.question + "," + record.category)
		record.availableToAnswerAt = 0
		return record
	})

	var bins = []
	var bin = []
	_.each(records, function (r) {
		bin.push(r)
		if (bin.length >= 10) {
			bins.push(bin)
			bin = []
		}
	})
	if (bin.length > 0)
		bins.push(bin)

	var count = 0
	var db = require('mongojs').connect(process.env.MONGOHQ_URL)
	_.each(bins, function (bin) {
	    var p = _.promise()
	    db.collection('records').insert(bin, p.set)
	    p.get()
	    count += bin.length
	    console.log("done with " + count)
	})
})
