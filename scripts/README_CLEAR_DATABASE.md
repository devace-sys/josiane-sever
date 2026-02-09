# Database Clear Script - Production Ready

## Overview

Enhanced production-safe database cleanup script with multiple safety features to prevent accidental data loss.

## ✅ Safety Features

1. **Environment Detection**: Prevents running in production without explicit override
2. **Confirmation Prompts**: Requires explicit "yes" confirmation
3. **Record Counting**: Shows how many records will be deleted
4. **Large Dataset Protection**: Additional confirmation for 1000+ records
5. **Detailed Logging**: Shows progress, timing, and statistics
6. **Graceful Error Handling**: Detailed error messages and recovery guidance
7. **Ctrl+C Handler**: Graceful shutdown on interrupt
8. **Performance Metrics**: Tracks deletion speed and duration

## 🚀 Usage

### Basic Usage (Development)
```bash
npm run clear-db
```

### With ts-node
```bash
npx ts-node scripts/clear-database.ts
```

### Production (DANGEROUS - Use with EXTREME caution)
```bash
ALLOW_PRODUCTION_CLEAR=true npx ts-node scripts/clear-database.ts
```

## ⚠️ Production Protection

The script will **REFUSE** to run if:
- `NODE_ENV=production`
- Database URL contains "production" or "prod"

Unless you explicitly set:
```bash
ALLOW_PRODUCTION_CLEAR=true
```

## 📊 Output Example

```
======================================================================
⚠️  DATABASE CLEANUP SCRIPT - PRODUCTION READY
======================================================================

⚠️  WARNING: This will DELETE ALL DATA from the database!
   Table structures will be preserved, but ALL records will be removed.

📊 Environment: development
🗄️  Database: localhost:5432/healthcare_db

📊 Counting existing records...
   Total records to be deleted: 15,423

⚠️  Type "yes" to confirm deletion (or anything else to cancel): yes

🚀 Starting database cleanup...

💡 TIP: Create a backup before proceeding if you haven't already!
   Command: pg_dump DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

----------------------------------------------------------------------
Starting deletion in dependency order...
----------------------------------------------------------------------

🗑️  Deleting Audit Logs...
   ✓ 1,234 record(s) deleted in 45ms
🗑️  Deleting Content Recommendations...
   ✓ 567 record(s) deleted in 23ms
...

======================================================================
✅ DATABASE CLEANUP COMPLETED SUCCESSFULLY!
======================================================================

📊 Summary:
   Total records deleted: 15,423
   Total duration: 2.34s
   Average speed: 6,591 records/sec

📋 Detailed Statistics:
   Audit Logs                     1,234 records (45ms)
   Messages                       8,901 records (321ms)
   Users                            123 records (12ms)
   ...

✅ All data has been deleted.
   Table structures are preserved.
   Database is ready for fresh data or seeding.
```

## 🔄 Deletion Order

Tables are deleted in dependency order (children before parents):

1. Audit Logs
2. Content Recommendations
3. Session Feedback
4. Message Attachments
5. Patient Upload Replies
6. Patient Uploads
7. Patient Products
8. Products
9. Showcases
10. Before/After Records
11. Checklists
12. Patient Content
13. Content
14. Session Questions
15. Session Instructions
16. Session Files
17. Sessions
18. Messages
19. Patient Access Records
20. Password Reset Tokens
21. Patient Profiles
22. Users
23. Clinic Config

## 🛡️ Error Handling

If an error occurs:
- Detailed error message is shown
- Stack trace is provided
- Warning about potential inconsistent state
- Guidance to restore from backup

## 📝 Best Practices

### Before Running:
1. **Create a backup**:
   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Verify environment**:
   ```bash
   echo $NODE_ENV
   echo $DATABASE_URL
   ```

3. **Check record count** (script does this automatically)

### After Running:
1. Verify database is empty (script shows count)
2. Run seeding if needed:
   ```bash
   npm run seed
   ```

## 🚫 NEVER DO THIS

❌ **DO NOT** run in production without backup  
❌ **DO NOT** bypass confirmation prompts programmatically  
❌ **DO NOT** ignore environment warnings  
❌ **DO NOT** run during business hours in production  
❌ **DO NOT** run without team coordination  

## ✅ Safe Usage Checklist

- [ ] Backup created
- [ ] Correct environment verified
- [ ] Team notified (if shared database)
- [ ] No active users (if shared environment)
- [ ] Recovery plan ready
- [ ] Time allocated for seeding (if needed)

## 🔧 Troubleshooting

### Script won't run in production
**Solution**: This is intentional. Set `ALLOW_PRODUCTION_CLEAR=true` only if absolutely necessary.

### Foreign key constraint errors
**Solution**: The script deletes in dependency order. If you see this, check for new tables not in the script.

### Timeout errors
**Solution**: For very large databases, increase Prisma timeout:
```typescript
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  __internal: {
    engine: {
      connectionTimeout: 60000,
    },
  },
});
```

### Permission errors
**Solution**: Ensure database user has DELETE permissions on all tables.

## 📞 Emergency Recovery

If something goes wrong:

1. **Stop the script**: Press Ctrl+C
2. **Restore from backup**:
   ```bash
   psql $DATABASE_URL < backup_YYYYMMDD_HHMMSS.sql
   ```
3. **Verify data**:
   ```bash
   npx ts-node scripts/verify-database.ts
   ```

## 🔒 Security Notes

- Script requires interactive terminal (no automated runs)
- Production environment blocked by default
- All deletions are logged
- Audit trail preserved in console output
- No silent failures

## 📊 Performance

Typical performance (depends on database size and hardware):
- Small database (< 1,000 records): 1-2 seconds
- Medium database (1,000 - 10,000 records): 2-5 seconds
- Large database (10,000 - 100,000 records): 5-30 seconds
- Very large database (> 100,000 records): 30+ seconds

## 🆕 What's New (Production Ready Update)

✅ Environment detection and protection  
✅ Interactive confirmation prompts  
✅ Record counting before deletion  
✅ Detailed progress logging  
✅ Performance metrics and statistics  
✅ Graceful error handling  
✅ Ctrl+C interrupt handling  
✅ Backup recommendations  
✅ Large dataset warnings  
✅ Production safety guards  

## 📚 Related Scripts

- `npm run seed` - Populate database with sample data
- `npx prisma migrate reset` - Reset migrations and clear data
- `npx prisma db push` - Push schema changes without migration

---

**Last Updated**: 2026-02-08  
**Version**: 2.0 (Production Ready)  
**Status**: ✅ Production Safe
