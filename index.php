<?php

require __DIR__ . '/src/common.php';

$router = $dice->create(Bramus\Router\Router::class);

// define routes

// all users
$router->get('/', function() use ($dice) {
    // json
    $dice->create(controllers\Index::class)->home();
});
$router->get('/api/about', function() use ($dice) {
    // json
    $dice->create(controllers\About::class)->about();
});
$router->get('/password', function() use ($dice) {
    // html
    $dice->create(controllers\Authentication::class)->password();
});
$router->get('/login', function() use ($dice) {
    // json
    $dice->create(controllers\Authentication::class)->login();
});
$router->post('/login', function() use ($dice) {
    // json
    $dice->create(controllers\Authentication::class)->login();
});
$router->get('/logout', function() use ($dice) {
    // json
    $dice->create(controllers\Authentication::class)->logout();
});
$router->get('/update', function() use ($dice) {
    // text
    $dice->create(controllers\Sources\Update::class)->updateAll();
});

// only for loggedin users or on public mode
$router->get('/rss', function() use ($dice) {
    // rss
    $dice->create(controllers\Rss::class)->rss();
});
$router->get('/feed', function() use ($dice) {
    // rss
    $dice->create(controllers\Rss::class)->rss();
});
$router->get('/items', function() use ($dice) {
    // json
    $dice->create(controllers\Items::class)->listItems();
});
$router->get('/tags', function() use ($dice) {
    // json
    $dice->create(controllers\Tags::class)->listTags();
});
$router->get('/stats', function() use ($dice) {
    // json
    $dice->create(controllers\Items\Stats::class)->stats();
});
$router->get('/items/sync', function() use ($dice) {
    // json
    $dice->create(controllers\Items\Sync::class)->sync();
});
$router->get('/sources/stats', function() use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->stats();
});

// only loggedin users
$router->post('/mark/([0-9]+)', function($itemId) use ($dice) {
    // json
    $dice->create(controllers\Items::class)->mark($itemId);
});
$router->post('/mark', function() use ($dice) {
    // json
    $dice->create(controllers\Items::class)->mark();
});
$router->post('/unmark/([0-9]+)', function($itemId) use ($dice) {
    // json
    $dice->create(controllers\Items::class)->unmark($itemId);
});
$router->post('/starr/([0-9]+)', function($itemId) use ($dice) {
    // json
    $dice->create(controllers\Items::class)->starr($itemId);
});
$router->post('/unstarr/([0-9]+)', function($itemId) use ($dice) {
    // json
    $dice->create(controllers\Items::class)->unstarr($itemId);
});
$router->post('/items/sync', function() use ($dice) {
    // json
    $dice->create(controllers\Items\Sync::class)->updateStatuses();
});

$router->get('/source/params', function() use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->params();
});
$router->get('/sources', function() use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->show();
});
$router->get('/source', function() use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->add();
});
$router->get('/sources/list', function() use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->listSources();
});
$router->post('/source/((?:new-)?[0-9]+)', function($id) use ($dice) {
    // json
    $dice->create(controllers\Sources\Write::class)->write($id);
});
$router->post('/source', function() use ($dice) {
    // json
    $dice->create(controllers\Sources\Write::class)->write();
});
$router->delete('/source/([0-9]+)', function($id) use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->remove($id);
});
$router->post('/source/delete/([0-9]+)', function($id) use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->remove($id);
});
$router->post('/source/([0-9]+)/update', function($id) use ($dice) {
    // json
    $dice->create(controllers\Sources\Update::class)->update($id);
});
$router->get('/sources/spouts', function() use ($dice) {
    // json
    $dice->create(controllers\Sources::class)->spouts();
});

$router->post('/tags/color', function() use ($dice) {
    // json
    $dice->create(controllers\Tags::class)->color();
});

$router->get('/opml', function() use ($dice) {
    // html
    $dice->create(controllers\Opml\ImportPage::class)->show();
});
$router->post('/opml', function() use ($dice) {
    // json
    $dice->create(controllers\Opml\Import::class)->add();
});
$router->get('/opmlexport', function() use ($dice) {
    // xml
    $dice->create(controllers\Opml\Export::class)->export();
});

// Client side routes need to be directed to index.html.
$router->get('/sign/in|/manage/sources(/add)?|/(newest|unread|starred)(/(all|tag-[^/]+|source-[0-9]+)(/[0-9]+)?)?', function() use ($dice) {
    // html
    $dice->create(controllers\Index::class)->home();
});

$router->set404(function() {
    header('HTTP/1.1 404 Not Found');
    echo 'Page not found.';
});

// dispatch
$router->run();
