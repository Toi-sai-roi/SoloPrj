const { query } = require('./config/db');

async function reset() {
    try {
        console.log('💥 Dropping all tables...');
        
        await query(`
            DROP TABLE IF EXISTS 
                online_users, 
                media_uploads, 
                group_reactions, 
                reactions, 
                group_messages, 
                group_members, 
                groups, 
                blocks, 
                friends, 
                messages, 
                users 
            CASCADE
        `);
        
        console.log('✅ All tables dropped');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

reset();