"""English seed corpus. Original sentences written for this project, released CC0.

Difficulty: 1 = short, common words, no punctuation beyond a final stop.
            2 = medium length, commas and apostrophes.
            3 = long, mixed punctuation, capitals mid-sentence, numbers as words.
"""

from app.models.enums import Language

SOURCE = "multilingual-typing-race seed corpus"
LICENSE = "CC0-1.0"

_LEVEL_1 = [
    "The cat sleeps on the warm stone steps all afternoon.",
    "We walked to the market and bought bread and figs.",
    "A small boat drifted slowly across the quiet lake.",
    "She keeps her keys in the blue bowl by the door.",
    "Rain fell softly on the roof until the morning came.",
    "The old clock in the hall runs three minutes fast.",
    "My brother learned to ride a bike in one weekend.",
    "Fresh snow covered the path to the wooden gate.",
    "The library closes early on the last day of the month.",
    "He planted tomatoes along the sunny side of the fence.",
]

_LEVEL_2 = [
    "Before the storm arrived, the fishermen pulled their nets ashore and tied the boats twice.",
    "It's strange how a song you haven't heard in years can bring back an entire summer.",
    "The recipe calls for two onions, a handful of parsley, and more patience than I usually have.",
    "Each morning the baker's daughter counted the loaves, chalked the number, and smiled.",
    "Nobody expected the bridge to hold, yet it carried traffic for another forty years.",
    "The museum's new wing, finished last spring, faces the river and catches the evening light.",
    "When the power went out, we lit candles, told stories, and forgot to check our phones.",
    "A good map doesn't show every street; it shows the streets you actually need.",
    "The train slowed as it entered the valley, and the passengers pressed against the windows.",
    "Her grandfather's workshop still smells of sawdust, oil, and strong black coffee.",
]

_LEVEL_3 = [
    '"You\'re late," said the conductor, tapping his watch; but the orchestra, having waited '
    "twenty minutes already, simply picked up their instruments and began without him.",
    "The committee met on Tuesday (as it always did), argued for three hours about the budget, "
    "and then approved exactly what had been proposed in the first place.",
    "Between the harbour and the old town there is a narrow street where, on market days, "
    "you can buy olives, copper pots, secondhand books, and, if you're lucky, fresh sardines.",
    "It wasn't the distance that made the journey hard; it was the wind, which came from the "
    "north at dawn and never once, in eleven days, changed its mind.",
    "The letter arrived on a Thursday, was read on Friday, and was answered, after much "
    "hesitation and two false starts, on the following Monday morning.",
    "Physics tells us that a dropped stone and a dropped feather fall alike in a vacuum; "
    "experience tells us that the feather will drift onto the neighbour's balcony.",
    '"Don\'t touch the red one," the engineer said quietly, and then, seeing my face, added: '
    '"Nothing dramatic would happen. It\'s just very, very expensive."',
    "The village had one bakery, two cafés, three churches, and, according to the sign at "
    "the entrance, a population of four hundred and twelve people plus one goat.",
    "Nineteen students signed up for the course; by the second week, seven remained, and by "
    'the exam in June, all seven passed with marks their teacher described as "suspiciously good."',
    "If you follow the river upstream for an hour, past the mill and the ruined chapel, you'll "
    "reach a pool so still that the trout seem to hang in the air rather than swim.",
]

ENTRIES: list[tuple[Language, str, int, str, str]] = [
    *((Language.EN, text, 1, SOURCE, LICENSE) for text in _LEVEL_1),
    *((Language.EN, text, 2, SOURCE, LICENSE) for text in _LEVEL_2),
    *((Language.EN, text, 3, SOURCE, LICENSE) for text in _LEVEL_3),
]
