
_.csv = function (data, headers) {
    if (headers === undefined) headers = true
    if (typeof(data) == 'object') {
        var s = []
        function escapeCsv(s) {
            if (s.match(/[,"\n]/))
                return '"' + s.replace(/"/g, '""') + '"'
            return s
        }
        function escapeLine(a) {
            return _.map(_.values(a), escapeCsv).join(',')
        }
        if (headers)
            s.push(escapeLine(_.keys(data[0])))
        _.each(data, function (row) {
            s.push(escapeLine(row))
        })
        return s.join('\n')

    } else if (typeof(data) == 'string') {
        function unescapeCsv(s) {
            if (s[0] == '"')
                return s.slice(1, s.length - 1).replace(/""/g, '"')
            return s
        }
        var bins = []
        var bin = []
        var re = /(^|,|\n)("(""|[^"])*"|[^,\r\n]*)/g
        var r
        while (r = re.exec(data)) {
            if (r[1] == '\n') {
                bins.push(bin)
                bin = []
            }
            bin.push(unescapeCsv(r[2]))
        }
        if (bin.length > 0)
            bins.push(bin)
        var last = bins[bins.length - 1]
        if (last.length == 1 && last[0] == "") bins.pop()
        if (headers) {
            headers = bins[0]
            bins = _.map(bins.slice(1), function (e) { return _.object(headers, e) })
        }
        return bins
    }
}
