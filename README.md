february-fire
=============

to run locally:

```
export PORT=5000
export HOST=http://localhost:5000
export MONGOHQ_URL=mongodb://localhost:27017/test
export SESSION_SECRET=doesnt_matter_locally
export ODESK_API_KEY=do_not_check_into_github
export ODESK_API_SECRET=do_not_check_into_github
export EDITORS=some,list,of,usernames
export PAYER=richy
export TEAMS=12345,23456

foreman start
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

git push heroku master
heroku addons:add mongohq:small
heroku ps:scale web=2
heroku open
```
