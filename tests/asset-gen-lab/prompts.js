// Simple Props (10)
const SIMPLE_PROPS = [
  { id: 'SP01', text: 'wooden barrel', focus: 'prop' },
  { id: 'SP02', text: 'treasure chest', focus: 'prop' },
  { id: 'SP03', text: 'gold coin', focus: 'prop' },
  { id: 'SP04', text: 'iron key', focus: 'prop' },
  { id: 'SP05', text: 'wooden crate', focus: 'prop' },
  { id: 'SP06', text: 'stone pedestal', focus: 'prop' },
  { id: 'SP07', text: 'simple torch', focus: 'prop' },
  { id: 'SP08', text: 'clay pot', focus: 'prop' },
  { id: 'SP09', text: 'wooden shield', focus: 'prop' },
  { id: 'SP10', text: 'metal bucket', focus: 'prop' }
];

// Complex Props (10)
const COMPLEX_PROPS = [
  { id: 'CP01', text: 'ornate lantern', focus: 'prop' },
  { id: 'CP02', text: 'magic scroll', focus: 'prop' },
  { id: 'CP03', text: 'bubbling potion', focus: 'prop' },
  { id: 'CP04', text: 'treasure orb', focus: 'prop' },
  { id: 'CP05', text: 'crystal ball', focus: 'prop' },
  { id: 'CP06', text: 'steampunk goggles', focus: 'wearable' },
  { id: 'CP07', text: 'war horn', focus: 'prop' },
  { id: 'CP08', text: 'leather backpack', focus: 'prop' },
  { id: 'CP09', text: 'music box', focus: 'prop' },
  { id: 'CP10', text: 'ancient tome', focus: 'prop' }
];

// Humanoids (10)
const HUMANOIDS = [
  { id: 'HU01', text: 'simple villager', focus: 'character' },
  { id: 'HU02', text: 'medieval knight', focus: 'character' },
  { id: 'HU03', text: 'wizard with staff', focus: 'character' },
  { id: 'HU04', text: 'blacksmith', focus: 'character' },
  { id: 'HU05', text: 'hooded archer', focus: 'character' },
  { id: 'HU06', text: 'anime fighter', focus: 'character' },
  { id: 'HU07', text: 'merchant', focus: 'character' },
  { id: 'HU08', text: 'royal guard', focus: 'character' },
  { id: 'HU09', text: 'pirate captain', focus: 'character' },
  { id: 'HU10', text: 'robot humanoid', focus: 'character' }
];

// Creatures (10)
const CREATURES = [
  { id: 'CR01', text: 'spider', focus: 'creature' },
  { id: 'CR02', text: 'octopus', focus: 'creature' },
  { id: 'CR03', text: 'dragon head trophy', focus: 'creature' },
  { id: 'CR04', text: 'robot dog', focus: 'creature' },
  { id: 'CR05', text: 'slime monster', focus: 'creature' },
  { id: 'CR06', text: 'flying bat', focus: 'creature' },
  { id: 'CR07', text: 'scorpion', focus: 'creature' },
  { id: 'CR08', text: 'crab', focus: 'creature' },
  { id: 'CR09', text: 'coiled snake', focus: 'creature' },
  { id: 'CR10', text: 'perched owl', focus: 'creature' }
];

// Animated (5)
const ANIMATED = [
  { id: 'AN01', text: 'spinning crystal', focus: 'animated' },
  { id: 'AN02', text: 'bobbing buoy', focus: 'animated' },
  { id: 'AN03', text: 'swaying flag', focus: 'animated' },
  { id: 'AN04', text: 'rotating fan', focus: 'animated' },
  { id: 'AN05', text: 'pulsing magic orb', focus: 'animated' }
];

// Architecture (5)
const ARCHITECTURE = [
  { id: 'AR01', text: 'stone archway', focus: 'building' },
  { id: 'AR02', text: 'wooden door', focus: 'building' },
  { id: 'AR03', text: 'castle tower', focus: 'building' },
  { id: 'AR04', text: 'brick wall', focus: 'building' },
  { id: 'AR05', text: 'wooden fence', focus: 'building' }
];

// Vehicles (5)
const VEHICLES = [
  { id: 'VE01', text: 'flying drone', focus: 'vehicle' },
  { id: 'VE02', text: 'race car', focus: 'vehicle' },
  { id: 'VE03', text: 'sailing ship', focus: 'vehicle' },
  { id: 'VE04', text: 'wooden cart', focus: 'vehicle' },
  { id: 'VE05', text: 'hot air balloon', focus: 'vehicle' }
];

// Edge Cases (5)
const EDGE_CASES = [
  { id: 'EC01', text: 'abstract sculpture', focus: 'abstract' },
  { id: 'EC02', text: 'infinity symbol', focus: 'symbol' },
  { id: 'EC03', text: 'single cube', focus: 'minimal' },
  { id: 'EC04', text: 'floating islands', focus: 'scope-test' },
  { id: 'EC05', text: 'army of soldiers', focus: 'scope-test' }
];

// All prompts combined
export const PROMPTS = [
  ...SIMPLE_PROPS,
  ...COMPLEX_PROPS,
  ...HUMANOIDS,
  ...CREATURES,
  ...ANIMATED,
  ...ARCHITECTURE,
  ...VEHICLES,
  ...EDGE_CASES
];

// Category groupings for filtered testing
export const PROMPT_CATEGORIES = {
  simple: SIMPLE_PROPS,
  complex: COMPLEX_PROPS,
  humanoids: HUMANOIDS,
  creatures: CREATURES,
  animated: ANIMATED,
  architecture: ARCHITECTURE,
  vehicles: VEHICLES,
  edge: EDGE_CASES
};

// Legacy 25 prompts for backward compatibility
export const PROMPTS_V1 = [
  { id: 'P01', text: 'wooden barrel', focus: 'prop' },
  { id: 'P02', text: 'treasure chest with metal bands', focus: 'prop' },
  { id: 'P03', text: 'steampunk goggles', focus: 'wearable' },
  { id: 'P04', text: 'simple humanoid villager with hat', focus: 'character' },
  { id: 'P05', text: 'anime fighter with scarf', focus: 'character' },
  { id: 'P06', text: 'medieval knight with shield', focus: 'character' },
  { id: 'P07', text: 'octopus', focus: 'creature' },
  { id: 'P08', text: 'spider', focus: 'creature' },
  { id: 'P09', text: 'dragon head trophy', focus: 'creature' },
  { id: 'P10', text: 'robot dog', focus: 'creature' },
  { id: 'P11', text: 'flying drone with 4 rotors', focus: 'vehicle' },
  { id: 'P12', text: 'race car', focus: 'vehicle' },
  { id: 'P13', text: 'sailing ship', focus: 'vehicle' },
  { id: 'P14', text: 'pine tree', focus: 'nature' },
  { id: 'P15', text: 'mushroom cluster', focus: 'nature' },
  { id: 'P16', text: 'cactus with arms', focus: 'nature' },
  { id: 'P17', text: 'crystal shard cluster', focus: 'prop' },
  { id: 'P18', text: 'treasure orb with glowing core', focus: 'prop' },
  { id: 'P19', text: 'ancient stone archway', focus: 'building' },
  { id: 'P20', text: 'sci-fi door panel', focus: 'prop' },
  { id: 'P21', text: 'lantern with glass', focus: 'prop' },
  { id: 'P22', text: 'hammer with wrapped handle', focus: 'tool' },
  { id: 'P23', text: 'mask with horns', focus: 'wearable' },
  { id: 'P24', text: 'kettle teapot with lid', focus: 'prop' },
  { id: 'P25', text: 'animated spinning crystal', focus: 'animated' }
];
