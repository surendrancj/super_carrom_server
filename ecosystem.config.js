module.exports = {
    apps: [{
        name:      'super-carrom',
        script:    'dist/arena.config.js',
        instances: 1,
        exec_mode: 'fork',
        watch:     false,
        env: {
            NODE_ENV: 'production',
        },
    }],
};
