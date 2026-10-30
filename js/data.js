/* ============================================================
   PRIMAL ISLE — shared game data
   ============================================================ */
(function () {
  'use strict';

  const RES = {
    wood: { name: 'Madeira', icon: '🪵' },
    stone: { name: 'Pedra', icon: '🪨' },
    fiber: { name: 'Fibra', icon: '🌿' },
    flint: { name: 'Sílex', icon: '🔸' },
    berry: { name: 'Frutas', icon: '🫐' },
    coconut: { name: 'Coco', icon: '🥥' },
    hide: { name: 'Couro', icon: '🟫' },
    meat: { name: 'Carne crua', icon: '🥩' },
    cooked: { name: 'Carne assada', icon: '🍗' },
    saddle: { name: 'Sela', icon: '🪢' },
  };

  const HOTBAR = [
    { id: 'hand', name: 'Mãos', icon: '✊', kind: 'tool' },
    { id: 'hatchet', name: 'Machado', icon: '🪓', kind: 'tool' },
    { id: 'pickaxe', name: 'Picareta', icon: '⛏️', kind: 'tool' },
    { id: 'spear', name: 'Lança', icon: '🗡️', kind: 'tool' },
    { id: 'torch', name: 'Tocha', icon: '🔥', kind: 'tool' },
    { id: 'berry', name: 'Frutas', icon: '🫐', kind: 'food', res: 'berry' },
    { id: 'cooked', name: 'Assada', icon: '🍗', kind: 'food', res: 'cooked' },
    { id: 'coconut', name: 'Coco', icon: '🥥', kind: 'food', res: 'coconut' },
  ];

  const RECIPES = [
    {
      id: 'hatchet',
      name: 'Machado de Pedra',
      icon: '🪓',
      desc: 'Derruba palmeiras rápido e rende mais madeira.',
      cost: { wood: 8, stone: 6, fiber: 4 },
      type: 'tool',
    },
    {
      id: 'pickaxe',
      name: 'Picareta de Pedra',
      icon: '⛏️',
      desc: 'Quebra rochas, extrai sílex e pedra em dobro.',
      cost: { wood: 8, stone: 10, fiber: 4 },
      type: 'tool',
    },
    {
      id: 'spear',
      name: 'Lança de Caça',
      icon: '🗡️',
      desc: 'A melhor arma contra o raptor. Não desperdice.',
      cost: { wood: 12, stone: 6, fiber: 8 },
      type: 'tool',
    },
    {
      id: 'torch',
      name: 'Tocha',
      icon: '🔥',
      desc: 'Ilumina a noite e mantém os olhos no escuro.',
      cost: { wood: 4, fiber: 6 },
      type: 'tool',
    },
    {
      id: 'campfire',
      name: 'Fogueira',
      icon: '🏕️',
      desc: 'Coloca uma fogueira à sua frente. Cura e assa carne.',
      cost: { stone: 16, wood: 10, flint: 4 },
      type: 'campfire',
      repeat: true,
    },
    {
      id: 'saddle',
      name: 'Sela de Couro',
      icon: '🪢',
      desc: 'Permite montar um parassauro domesticado.',
      cost: { hide: 12, fiber: 18, wood: 10 },
      type: 'saddle',
    },
    {
      id: 'bandage',
      name: 'Curativo de Fibra',
      icon: '🩹',
      desc: 'Recupera 35 de vida imediatamente.',
      cost: { fiber: 8, hide: 2 },
      type: 'heal',
      repeat: true,
    },
  ];

  const TOOL_DAMAGE = { hand: 9, hatchet: 18, pickaxe: 17, spear: 26, torch: 10 };
  const FOOD = {
    berry: { food: 7, water: 9, health: 0, label: 'Frutas' },
    cooked: { food: 32, water: 2, health: 10, label: 'Carne assada' },
    coconut: { food: 10, water: 24, health: 0, label: 'Coco' },
  };

  window.PI = {
    RES,
    HOTBAR,
    RECIPES,
    TOOL_DAMAGE,
    FOOD,
    SAVE_KEY: 'primalisle.save.v2',
    SETTINGS_KEY: 'primalisle.settings.v1',
    DAY_LENGTH: 420,
    DAY_START: 0.315,
  };
})();
