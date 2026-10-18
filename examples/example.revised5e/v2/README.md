# Revised 5e Encounter module, version 1.0.0

This is a separate, bundled V2 module. It is not discovered by the legacy V1 module loader. The host selects it only when the GM explicitly pins `example.revised5e` on the default-off V2 API. Its exact lock digest covers the manifest, rules/extension source and declarative combat contribution.

The encounter contains two original player characters, Mira Vale and Oren Pike, and an original enemy, the Mire Warden. Their names, descriptions and stat choices are original example content. Club and shortsword weapon dice are SRD 5.2.1 equipment data.

## Included rules

- Each combatant rolls one host supplied d20 for initiative. The initiative modifier is the Dexterity modifier. Highest total acts first and the order repeats each round. Initiative ties use the encounter's stable actor order as a documented table procedure; the SRD leaves tie ordering to the GM and players.
- A turn permits one Attack action. The host accepts the command only for the current actor and rejects reused, defeated, stale or out-of-turn actions. Players can act only for their enrolled character; only the GM can act for the enemy.
- The attack total is a host supplied d20 plus the weapon's selected ability modifier, plus proficiency bonus only when the actor is proficient. A natural 1 misses and a natural 20 hits and is a critical hit, regardless of AC. Otherwise the total must meet or exceed target AC.
- On a hit, roll the weapon die and add the same ability modifier used for the attack, with damage floored at zero. On a critical hit, roll that weapon die twice and add the modifier once. Damage reduces current HP to a minimum of zero; zero HP marks the encounter participant defeated and ends this example encounter.
- This slice deliberately has no advantage/disadvantage, cover, reach/range, resistance, extra attacks, opportunity attacks, conditions, healing, movement or player character build rules.

Mechanics references in the [official SRD 5.2.1 PDF](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf): attack rolls, natural 1/20 and AC (pp. 6–7); initiative, turns and the one-action allowance (p. 12); damage, HP and critical damage dice (pp. 16–17); weapon proficiency and weapon dice (pp. 89–90). The encounter's stable-order tie procedure and end-at-zero encounter behavior are example-specific table procedures, not claimed as SRD rules.

## Attribution

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

No other Wizards-owned character, creature, setting or narrative content is included.
