february-fire
=============

to run locally:

```
mongod &
node web.js test
```

===

to setup on heroku:

```
heroku create

heroku config:set HOST=https://random-name-6789.herokuapp.com
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET=do_not_check_into_github
heroku config:set ODESK_API_KEY=do_not_check_into_github
heroku config:set ODESK_API_SECRET=do_not_check_into_github
heroku config:set EDITORS=some,list,of,usernames
heroku config:set PAYER=richy
heroku config:set TEAMS=12345,23456
heroku config:set MAX_PAYOUT=1000

git push heroku master
heroku addons:add mongohq:small
heroku ps:scale web=2
heroku addons:add scheduler:standard
heroku open
```
