# TKD Scoring CSV import test pack

Synthetic test data only: **4 clubs, 4 categories, and 12 athletes**. Names and `example.com` email addresses are not intended to identify real people.

## Import order

Use a fresh test tournament and import these files in order:

1. **Clubs → Import CSV:** select `01-clubs-test.csv`.
2. **Categories → Import CSV:** select `02-categories-test.csv`.
3. **Athletes → Import CSV:** select `03-athletes-import.csv`.

The expected result is:

- 4 clubs;
- 4 categories;
- 12 unique athletes;
- 3 registered athletes with passing weigh-ins in each category;
- every athlete assigned to the club/category named in their row.

Athlete `clubName` and `categoryName` values are matched case-insensitively against existing clubs/categories in the same tournament. Import clubs and categories first so these names resolve. Existing `clubId` and `categoryId` UUID fields also remain supported; the test file leaves them blank to use name-based matching.

## Validation behavior

- Each file is processed row by row, up to 500 data rows.
- A rejected row does not silently overwrite another record or stop later valid rows from being attempted.
- Reimporting the club/category files rejects existing names instead of duplicating them.
- Reimporting the athletes rejects matching name/birth-date duplicates.
- Missing clubs/categories, incompatible divisions, and out-of-range weigh-ins are rejected with a per-row error.

## Category notes

The category timing and tie-policy values are test examples, not claims of WT certification or event-specific approval. Verify them against the regulations adopted by your event.
