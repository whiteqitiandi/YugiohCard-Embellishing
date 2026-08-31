# Master Duel card classification notes

Checked: 2026-08-30

## Rendering model

- Monster attributes are DARK, LIGHT, EARTH, WATER, FIRE, WIND, and DIVINE.
  Spell and Trap use their own card symbols; they are not monster attributes.
- Normal, Effect, Ritual, Fusion, and Synchro Monsters use Levels. Xyz Monsters
  use Ranks instead of Levels. Link Monsters use a Link Rating and Link Arrows,
  and do not have DEF.
- Pendulum is an additional card property. A Pendulum Monster has two effect
  boxes and left/right Scales, while retaining an underlying monster frame such
  as Effect, Ritual, Fusion, Synchro, or Xyz.
- Spell subtypes are Normal, Continuous, Equip, Field, Quick-Play, and Ritual.
  Trap subtypes are Normal, Continuous, and Counter. Normal Spell/Trap cards do
  not receive a subtype icon.

## Master Rule behavior reflected in the data model

- Fusion, Synchro, and Xyz Monsters are Extra Deck monster categories; Ritual
  Monsters belong in the Main Deck and are Ritual Summoned using a Ritual Spell.
- A Synchro Summon normally uses a Tuner plus non-Tuners whose Levels total the
  Synchro Monster's Level.
- An Xyz Summon normally overlays monsters of the same Level; the resulting Xyz
  Monster has a Rank, so effects that specifically refer to Levels do not treat
  its Rank as a Level.
- A Pendulum Monster can be used as a monster, or activated as a Spell in a
  Pendulum Zone. Pendulum Monsters sent from the field to the GY are placed
  face-up in the Extra Deck instead.
- Under the Master Rule revision used by Master Duel, Fusion, Synchro, and Xyz
  Monsters can be Special Summoned from the Extra Deck to a Main Monster Zone.
  Link Monsters and face-up Pendulum Monsters summoned from the Extra Deck still
  use an Extra Monster Zone or a Main Monster Zone a Link Arrow points to.

## Sources

- Konami Master Duel: https://www.konami.com/yugioh/masterduel/eu/en/
- Konami official rulebook v10: https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf
- Konami OCG rules portal: https://www.yugioh-card.com/japan/howto/
- Master Duel Meta expanded rulebook: https://www.masterduelmeta.com/articles/guides/expanded-rule-book
- Master Rule 2020 rules update: https://www.masterduelmeta.com/articles/news/november-2021/rules-update
