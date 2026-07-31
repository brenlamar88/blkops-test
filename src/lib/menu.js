// Single source of truth for the sidebar. The nav renders from it, per-user
// visibility filters it, and the Users admin screen lists the same items as
// toggles — all keyed by route path so a menu_key in user_menu_visibility
// always matches a real destination.

export const MENU = [
  ['Daily work', [['/', 'Dashboard'], ['/activities', 'Activities'], ['/referrals', 'Referrals']]],
  ['Accounts', [['/companies', 'Companies'], ['/contacts', 'Contacts'],
                ['/needs-analysis', 'Needs analysis']]],
  ['Reporting', [['/activity-dashboard', 'Activity dashboard'], ['/reports', 'Reports']]],
]

// Shown only to managers/admins; Users itself is gated to admins in the nav.
export const ADMIN_MENU = ['Admin', [['/territory-map', 'Territory map'], ['/users', 'Users']]]

// Dashboard is the landing page and never hideable, so it is not a toggle.
export const HIDEABLE_ITEMS = [...MENU, ADMIN_MENU]
  .flatMap(([group, items]) => items.map(([key, label]) => ({ key, label, group })))
  .filter((i) => i.key !== '/')
