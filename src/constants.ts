// Room
export const ROOM_WIDTH = 20;
export const ROOM_DEPTH = 20;
export const ROOM_HEIGHT = 4;

// Player
export const PLAYER_HEIGHT = 1.7;
export const PLAYER_SPEED = 6.0; // units/sec at full speed
export const ACCELERATION = 50.0;
export const FRICTION = 8.0;
export const PLAYER_RADIUS = 0.4;

// Weapon
export const FIRE_RATE = 0.1; // seconds between shots
export const MAG_SIZE = 30;
export const RELOAD_TIME = 2.5; // seconds
export const RECOIL_AMOUNT = 0.03; // radians per shot
export const RECOIL_RECOVERY = 6.0; // radians/sec recovery

// Muzzle flash
export const MUZZLE_FLASH_PEAK_INTENSITY = 12;
export const MUZZLE_FLASH_DECAY_RATE = 20;
export const MUZZLE_FLASH_DURATION = 0.1;
export const MUZZLE_FLASH_LIGHT_DISTANCE = 15;
export const MUZZLE_FLASH_LIGHT_DECAY = 1;

// Bloom (active when muzzle flash FX enabled)
export const BLOOM_STRENGTH = 2.0;
export const BLOOM_RADIUS = 0.4;
export const BLOOM_THRESHOLD = 0.8;

// Targets
export const TARGET_COUNT = 5;
export const TARGET_RADIUS = 0.3;
export const TARGET_MIN_HEIGHT = 0.8;
export const TARGET_MAX_HEIGHT = 2.5;
export const TARGET_SPAWN_MARGIN = 1.5; // distance from walls

// Audio
export const GUNSHOT_DURATION = 0.08;
export const HIT_SOUND_DURATION = 0.12;
export const HIT_SOUND_FREQ = 800;
