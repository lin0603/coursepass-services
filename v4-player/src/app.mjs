// V4 player app: learning map (default) -> lesson -> back to map.
import { renderMap } from './map.mjs';
import { playLesson } from './player.mjs';
import { fetchPlacement } from './placement.mjs';

const params = new URLSearchParams(location.search);
const API = (params.get('api') || 'https://companion-api-dev.starxinteractive.com').replace(/\/$/, '');
const TOKEN_KEY = 'v4-player:token';
if (params.get('token')) localStorage.setItem(TOKEN_KEY, params.get('token'));
const AUTH = localStorage.getItem(TOKEN_KEY) || 'cp-dev-token-change-me';
const LEARNER = params.get('learner') || 'v4-demo';
const LIMIT = Math.min(Math.max(Number(params.get('limit')) || 10, 1), 20);
let unit = params.get('unit') || 'N-5-4';

const root = document.getElementById('app');

function showMap() {
  const url = new URL(location.href);
  url.searchParams.set('unit', unit);
  url.searchParams.delete('view');
  history.replaceState(null, '', url);
  renderMap(root, { api: API, auth: AUTH, learner: LEARNER, unit, onSelect: startLesson, onPlacement: startPlacement });
}

function startPlacement(nodeId) {
  unit = nodeId || unit;
  const url = new URL(location.href);
  url.searchParams.set('unit', unit);
  url.searchParams.set('view', 'placement');
  history.replaceState(null, '', url);
  playLesson(root, {
    api: API, auth: AUTH, learner: LEARNER, unit, limit: 5,
    loadSet: () => fetchPlacement(API, AUTH, unit, 5),
    onExit: showMap,
  });
}

function startLesson(nodeId) {
  unit = nodeId;
  const url = new URL(location.href);
  url.searchParams.set('unit', unit);
  url.searchParams.set('view', 'lesson');
  history.replaceState(null, '', url);
  playLesson(root, { api: API, auth: AUTH, learner: LEARNER, unit, limit: LIMIT, onExit: showMap });
}

if (params.get('view') === 'lesson' && params.get('unit')) startLesson(unit);
else if (params.get('view') === 'placement') startPlacement(params.get('unit') || unit);
else showMap();
