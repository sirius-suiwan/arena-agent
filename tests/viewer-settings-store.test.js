import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clearSetup, readSetup, sanitizeSetup, saveSetup} from '../viewer/settings-store.js';

test('setup storage keeps only validated settings and never keeps a fixed seed', () => {
  const invalid = sanitizeSetup({
    seed: 0,
    options: {cols: 1000, rows: 8, mapSizeMode: 'auto', mazeComplexity: 'auto', simulationRate: '25', shrinkCenter: 'center', friendlyFire: false},
    bots: {A: 'gpt-dots', B: '../unsafe', C: ''},
    seats: {A: 'control:arrows', B: 'control:arrows', C: 'bot:laika', D: '', X: 'control:mouse'},
    teams: {A: '2', C: '6'}, teamMode: true,
    names: {A: '  One   Two  ', B: '🌲'.repeat(25)},
  });
  assert.deepEqual(invalid, {
    options: {rows: 8, mapSizeMode: 'auto', mazeComplexity: 'auto', friendlyFire: false, shrinkCenter: 'center'},
    bots: {A: 'gpt-dots', C: ''},
    seats: {A: 'control:arrows', C: 'bot:laika', D: ''},
    teams: {A: '2'}, names: {A: 'One Two'}, teamMode: true,
  });
});

test('setting storage restores valid choices and handles reset, malformed data and denial', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let raw = '{broken';
  try {
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
      getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = null; },
    }});
    assert.deepEqual(readSetup(), sanitizeSetup());
    saveSetup({options: {mapSizeMode: 'manual', cols: 16, shrinkCenter: 'random'}, teams: {A: '3'}});
    assert.deepEqual(readSetup().options, {mapSizeMode: 'manual', cols: 16, shrinkCenter: 'random'});
    assert.deepEqual(readSetup().teams, {A: '3'});
    clearSetup();
    assert.deepEqual(readSetup(), sanitizeSetup());
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('denied'); }});
    assert.doesNotThrow(() => saveSetup({}));
    assert.doesNotThrow(clearSetup);
    assert.deepEqual(readSetup(), sanitizeSetup());
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
