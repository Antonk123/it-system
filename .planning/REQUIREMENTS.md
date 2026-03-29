# Requirements: IT Ticket System

**Defined:** 2026-03-30
**Core Value:** Every ticket gets tracked, resolved, and documented — nothing falls through the cracks and solutions are reusable.

## v1.3 Requirements

Requirements for Streamline & Declutter milestone. Each maps to roadmap phases.

### Quick Capture

- [ ] **QCAP-01**: User can create a ticket with just a title — priority, category, and tags default automatically
- [ ] **QCAP-02**: Public form skips name/email when used by the logged-in user, acting as a quick-add
- [ ] **QCAP-03**: User can clone an existing ticket as a new one with title, description, category, and template fields pre-filled

### Form Simplification

- [ ] **FORM-01**: Ticket create/edit form uses collapsible sections (basics, details, template fields) — only expand what's needed
- [ ] **FORM-02**: Ticket edit view hides empty optional fields (notes, solution, custom fields) until user clicks to add them
- [ ] **FORM-03**: Template picker is a lightweight dropdown on the create form instead of a separate flow
- [ ] **FORM-04**: All dropdowns (category, priority, assignee, template, tags) are searchable/filterable

### Cleanup

- [ ] **CLEAN-01**: Remove KB view counter (view_count column, API increment, display)
- [ ] **CLEAN-02**: Remove "Senast uppdaterade" section from KB home
- [ ] **CLEAN-03**: Remove default unused templates (Lösenordsåterställning, Ny användare)
- [ ] **CLEAN-04**: Remove "Populära artiklar" section from KB home (depends on view_count removal)

## Future Requirements

None deferred — all identified features scoped into v1.3.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user quick capture (shared quick-add links) | Single user system |
| Drag-and-drop form builder | Over-engineering for single user with one template |
| AI-powered auto-categorization | Not needed at current ticket volume |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| QCAP-01 | — | Pending |
| QCAP-02 | — | Pending |
| QCAP-03 | — | Pending |
| FORM-01 | — | Pending |
| FORM-02 | — | Pending |
| FORM-03 | — | Pending |
| FORM-04 | — | Pending |
| CLEAN-01 | — | Pending |
| CLEAN-02 | — | Pending |
| CLEAN-03 | — | Pending |
| CLEAN-04 | — | Pending |

**Coverage:**
- v1.3 requirements: 11 total
- Mapped to phases: 0
- Unmapped: 11 ⚠️

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after initial definition*
