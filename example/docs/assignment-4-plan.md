# Assignment 4: plan

Example plan doc.

## Decision: chaining or open addressing?

- **Where:** the collision part; it decides how `delete` works.
- **Why now:** delete and resize are the next two things to write.
- **Default if you say nothing:** chaining. The lecture notes use it and the provided tests expect a list per bucket.

## Order

1. Delete (with the decision above).
2. Resize when the load factor passes 0.75.
3. Run the provided tests.
4. One-page write-up on collisions.

## Done when

- All provided tests pass.
- The write-up fits on one page.
