export const TURN_TIMER_MS = 120 * 1000;
export const PROMPT_TIMER_MS = 30 * 1000;
export const MAX_HAND_SIZE = 7;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 18;
export const MAX_PLAYS_PER_TURN = 3;

export const COLORS = {
    brown: {
        key: 'brown',
        label: 'Brown',
        setSize: 2,
        rent: [1, 2],
        propertyValue: 1,
        allowBuildings: true
    },
    lightBlue: {
        key: 'lightBlue',
        label: 'Light Blue',
        setSize: 3,
        rent: [1, 2, 3],
        propertyValue: 1,
        allowBuildings: true
    },
    pink: {
        key: 'pink',
        label: 'Pink',
        setSize: 3,
        rent: [1, 2, 4],
        propertyValue: 2,
        allowBuildings: true
    },
    orange: {
        key: 'orange',
        label: 'Orange',
        setSize: 3,
        rent: [1, 3, 5],
        propertyValue: 2,
        allowBuildings: true
    },
    red: {
        key: 'red',
        label: 'Red',
        setSize: 3,
        rent: [2, 3, 6],
        propertyValue: 3,
        allowBuildings: true
    },
    yellow: {
        key: 'yellow',
        label: 'Yellow',
        setSize: 3,
        rent: [2, 4, 6],
        propertyValue: 3,
        allowBuildings: true
    },
    green: {
        key: 'green',
        label: 'Green',
        setSize: 3,
        rent: [2, 4, 7],
        propertyValue: 4,
        allowBuildings: true
    },
    blue: {
        key: 'blue',
        label: 'Dark Blue',
        setSize: 2,
        rent: [3, 8],
        propertyValue: 4,
        allowBuildings: true
    },
    railroad: {
        key: 'railroad',
        label: 'Railroad',
        setSize: 4,
        rent: [1, 2, 3, 4],
        propertyValue: 2,
        allowBuildings: false
    },
    utility: {
        key: 'utility',
        label: 'Utility',
        setSize: 2,
        rent: [1, 2],
        propertyValue: 2,
        allowBuildings: false
    }
};
