import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeDecks } from '../bridge-decks.js';

test('a split crossing clears level water and rejoins the road at both ends', () => {
  const ways = [[[-60,0],[0,0]],[[0,0],[60,0]]].map(g => ({t:{bridge:'yes'},hw:5,g}));
  const deck = bridgeDecks(ways, () => -3, x => Math.abs(x)<55 ? 2 : null);
  for(let x=-55;x<=55;x+=0.5) assert.ok(deck.height(x,4)>=6);
  assert.equal(deck.height(180,0),-3);
  assert.equal(deck.height(0,20),-3);
  assert.ok(deck.height(70,0)>deck.height(80,0));
  assert.equal(bridgeDecks(ways,()=>7,()=>null).active,false);
});

test('the cross street and its verge rise together, without a ridge at the bridge width', () => {
  const road = {t:{bridge:'yes'},hw:5,walk:true,g:[[-45,0],[45,0]]};
  const deck = bridgeDecks([road],()=>0, x=>Math.abs(x)<42 ? 0 : null);
  let prev = deck.height(48,0);
  for (let z=1;z<90;z++) {
    const y = deck.height(48,z);
    assert.equal(deck.banks.height(48,z),y);
    assert.ok(Math.abs(prev-y)<0.16);
    prev=y;
  }
  assert.equal(deck.banks.height(0,0),0);
});
