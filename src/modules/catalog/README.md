# Catalog

Owns canonical competencies, prerequisite DAG, activities, resources, and roadmap templates. The
foundation reserves this boundary only.

## Implemented Explore target closure query

`catalog.get_explore_target_closure_impl` resolves one exact published or retired Catalog/Roadmap
pair into deterministic target scope: roadmap membership, required canonical seeds, every incoming
transitive prerequisite ancestor, and competency domain parents. It returns only the bounded nodes
and relevant prerequisite edges, including descriptions and rationales. It knows no workspace
goal, target rule, overlay, Mastery, or readiness state; the `api` read projection supplies only
stable owner-query inputs.
