import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigation } from './navigation';

test('home has distinct independent mode setup routes', () => {
 const nav = createNavigation();
 assert.equal(nav.snapshot.screen, 'home');
 nav.request('setup', 'free', false);
 assert.deepEqual(nav.snapshot, { screen:'setup', mode:'free', pending:null, waiting:false });
 nav.request('home', 'free', false);
 nav.request('setup', 'main', false);
 assert.equal(nav.snapshot.mode, 'main');
});
test('live experiment cannot leave until deliberate finish has settled', () => {
 const nav = createNavigation();
 nav.request('playing','main',false);
 assert.equal(nav.request('home','main',true),false);
 assert.equal(nav.snapshot.screen,'playing');
 assert.deepEqual(nav.snapshot.pending,{screen:'home',mode:'main'});
 assert.equal(nav.confirmFinish(),true);
 assert.equal(nav.snapshot.screen,'playing');
 assert.equal(nav.snapshot.waiting,true);
 nav.settle();
 assert.equal(nav.snapshot.screen,'home');
 assert.equal(nav.snapshot.pending,null);
});
test('canceling navigation preserves current experiment and mode', () => {
 const nav = createNavigation();
 nav.request('playing','free',false);
 nav.request('setup','main',true);
 nav.cancel();
 assert.deepEqual(nav.snapshot,{screen:'playing',mode:'free',pending:null,waiting:false});
 assert.equal(nav.confirmFinish(),false);
});
test('pending route is not mutable through diagnostic snapshots', () => {
 const nav = createNavigation();
 nav.request('playing','main',false);
 nav.request('setup','main',true);
 const read=nav.snapshot;
 read.screen='home';
 read.pending!.mode='free';
 assert.equal(nav.snapshot.screen,'playing');
 assert.equal(nav.snapshot.pending!.mode,'main');
});
