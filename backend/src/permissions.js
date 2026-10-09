const { q } = require('./db');

/**
 * Access rights an admin can grant on top of a user's role.
 *
 * These exist so someone can run the public website without being made an
 * admin — an admin can also approve registrations, issue certificates and
 * read every student's data, which a web manager has no business doing.
 *
 * `group` only drives how the admin UI lays these out.
 */
const PERMISSIONS = [
  {
    key: 'website.highlights',
    group: 'Website',
    label: 'Manage Highlights',
    description: 'Create, edit, publish and delete highlights and their photos on iosdc.geu.ac.in',
  },
  {
    key: 'website.apps',
    group: 'Website',
    label: 'Manage Apps',
    description: "Add and edit the apps shown on each cohort's public page",
  },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Students never hold website permissions; granting one would be a mistake,
// not a choice, so it is rejected rather than quietly ignored.
const GRANTABLE_ROLES = ['mentor', 'volunteer'];

function isValidPermission(key) {
  return PERMISSION_KEYS.includes(key);
}

/**
 * Every permission a user holds. Admins implicitly hold all of them, so they
 * never need rows in user_permissions and can't be locked out by an empty
 * grant list.
 */
async function permissionsFor(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...PERMISSION_KEYS];

  // A role the catalogue never grants to holds nothing, whatever rows exist.
  // Without this, demoting a mentor to student would leave their grants live:
  // the grant endpoint refuses students, but it can't undo a later role change.
  if (!GRANTABLE_ROLES.includes(user.role)) return [];

  const rows = await q(`SELECT permission FROM user_permissions WHERE user_id = ?`, [user.id]);
  // Drop anything no longer in the catalogue (a permission we removed in code).
  return rows.map((r) => r.permission).filter(isValidPermission);
}

/**
 * Route guard. Passes when the user is an admin or holds ANY of the listed
 * permissions.
 *
 * Deliberately reads from the database rather than the JWT: tokens last 7
 * days, so baking permissions into them would mean a revoked right stayed
 * usable for up to a week.
 */
function requirePermission(...keys) {
  return async function (req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (req.user.role === 'admin') return next();

      const held = await permissionsFor(req.user);
      if (keys.some((k) => held.includes(k))) return next();

      return res.status(403).json({
        error: 'You do not have access to this. Ask an admin to grant it in Users → Access.',
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  GRANTABLE_ROLES,
  isValidPermission,
  permissionsFor,
  requirePermission,
};
