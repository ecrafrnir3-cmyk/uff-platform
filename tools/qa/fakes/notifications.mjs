// Stand-in for @/lib/notifications: records, notifies nobody.
export async function createNotification(args) { globalThis.__QA__.notifications.push({ type: args?.type }); }
