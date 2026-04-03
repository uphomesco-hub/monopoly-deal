import { COLORS } from './constants';

export const CARD_TEMPLATES = [
    ...buildPropertyTemplates(),
    ...buildWildTemplates(),
    ...buildRentTemplates(),
    ...buildActionTemplates(),
    ...buildMoneyTemplates()
];

function buildPropertyTemplates() {
    return [
        property('property_brown', 'Brown Property', 'brown', 2),
        property('property_light_blue', 'Light Blue Property', 'lightBlue', 3),
        property('property_pink', 'Pink Property', 'pink', 3),
        property('property_orange', 'Orange Property', 'orange', 3),
        property('property_red', 'Red Property', 'red', 3),
        property('property_yellow', 'Yellow Property', 'yellow', 3),
        property('property_green', 'Green Property', 'green', 3),
        property('property_blue', 'Dark Blue Property', 'blue', 2),
        property('property_railroad', 'Railroad Property', 'railroad', 4),
        property('property_utility', 'Utility Property', 'utility', 2)
    ];
}

function buildWildTemplates() {
    return [
        propertyWild('wild_brown_light_blue', 'Brown / Light Blue Wild', ['brown', 'lightBlue'], 1),
        propertyWild('wild_light_blue_railroad', 'Light Blue / Railroad Wild', ['lightBlue', 'railroad'], 1, 4),
        propertyWild('wild_pink_orange', 'Pink / Orange Wild', ['pink', 'orange'], 2, 2),
        propertyWild('wild_red_yellow', 'Red / Yellow Wild', ['red', 'yellow'], 2, 3),
        propertyWild('wild_green_blue', 'Green / Dark Blue Wild', ['green', 'blue'], 1, 4),
        propertyWild('wild_green_railroad', 'Green / Railroad Wild', ['green', 'railroad'], 1, 4),
        propertyWild('wild_railroad_utility', 'Railroad / Utility Wild', ['railroad', 'utility'], 1, 2),
        propertyWild('wild_any', 'Wild Property', ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'blue', 'railroad', 'utility'], 2, 0, true)
    ];
}

function buildRentTemplates() {
    return [
        rent('rent_brown_light_blue', 'Brown / Light Blue Rent', ['brown', 'lightBlue'], 2, 1),
        rent('rent_pink_orange', 'Pink / Orange Rent', ['pink', 'orange'], 2, 1),
        rent('rent_red_yellow', 'Red / Yellow Rent', ['red', 'yellow'], 2, 1),
        rent('rent_green_blue', 'Green / Dark Blue Rent', ['green', 'blue'], 2, 1),
        rent('rent_railroad_utility', 'Railroad / Utility Rent', ['railroad', 'utility'], 2, 1),
        rent('rent_any', 'Any Color Rent', ['any'], 3, 3, true)
    ];
}

function buildActionTemplates() {
    return [
        action('deal_breaker', 'Deal Breaker', 'dealBreaker', 2, 5),
        action('forced_deal', 'Forced Deal', 'forcedDeal', 3, 3),
        action('sly_deal', 'Sly Deal', 'slyDeal', 3, 3),
        action('just_say_no', 'Just Say No', 'justSayNo', 3, 4),
        action('debt_collector', 'Debt Collector', 'debtCollector', 3, 3),
        action('its_my_birthday', "It's My Birthday", 'birthday', 3, 2),
        action('double_the_rent', 'Double The Rent', 'doubleRent', 2, 1),
        action('house', 'House', 'house', 3, 3),
        action('hotel', 'Hotel', 'hotel', 2, 4),
        action('pass_go', 'Pass Go', 'passGo', 10, 1)
    ];
}

function buildMoneyTemplates() {
    return [
        money('money_1', '1M', 1, 6),
        money('money_2', '2M', 2, 5),
        money('money_3', '3M', 3, 3),
        money('money_4', '4M', 4, 3),
        money('money_5', '5M', 5, 2),
        money('money_10', '10M', 10, 1)
    ];
}

function property(id, name, color, copies) {
    return {
        id,
        name,
        category: 'property',
        type: 'property',
        colors: [color],
        value: COLORS[color].propertyValue,
        setSize: COLORS[color].setSize,
        rent: COLORS[color].rent,
        copies,
        isWild: false,
        allowBuildings: COLORS[color].allowBuildings
    };
}

function propertyWild(id, name, colors, copies, value = 0, isMulti = false) {
    return {
        id,
        name,
        category: 'property',
        type: 'propertyWild',
        colors,
        value,
        copies,
        isWild: true,
        isMulti
    };
}

function rent(id, name, colors, copies, value, isAny = false) {
    return {
        id,
        name,
        category: 'action',
        type: 'rent',
        actionType: 'rent',
        colors,
        value,
        copies,
        isAny
    };
}

function action(id, name, actionType, copies, value) {
    return {
        id,
        name,
        category: 'action',
        type: 'action',
        actionType,
        value,
        copies
    };
}

function money(id, name, value, copies) {
    return {
        id,
        name,
        category: 'money',
        type: 'money',
        value,
        copies
    };
}

function createDeck(deckCount) {
    const cards = {};
    const drawPile = [];

    for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
        for (const template of CARD_TEMPLATES) {
            for (let copyIndex = 0; copyIndex < template.copies; copyIndex += 1) {
                const id = `${template.id}::d${deckIndex + 1}::c${copyIndex + 1}`;
                const card = {
                    ...template,
                    instanceId: id,
                    deckIndex: deckIndex + 1
                };
                cards[id] = card;
                drawPile.push(id);
            }
        }
    }

    shuffle(drawPile);

    return {
        cards,
        drawPile
    };
}

function shuffle(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const otherIndex = Math.floor(Math.random() * (index + 1));
        [items[index], items[otherIndex]] = [items[otherIndex], items[index]];
    }
    return items;
}

function getDeckCountForPlayers(playerCount) {
    if (playerCount <= 6) {
        return 1;
    }
    if (playerCount <= 12) {
        return 2;
    }
    return 3;
}

export {
    createDeck,
    shuffle,
    getDeckCountForPlayers
};
