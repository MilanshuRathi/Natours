//Importing Express application from app.js
require('dotenv').config();
const mongoose = require('mongoose');
//Handler for Synchronous code expections (Uncaught Exceptions)
process.on('uncaughtException',err=>{
    console.log(`UNCAUGHT EXCEPTION...\n${err.name} : ${err.message}\nShutting down the app`);    
    process.exit(1);
});
const app = require(`${__dirname}/app`);
//Configuring connection with Database
const url= process.env.DB.replace('<password>', process.env.DB_PASSWD);
mongoose.connect(url, { useNewUrlParser: true, useCreateIndex: true, useFindAndModify: false, useUnifiedTopology: true }).then(() => console.log('Connection to DB is successful'));
//In case to connect with local database
// mongoose.connect(process.env.DB_LOCAL,{useNewUrlParser:true,useCreateIndex:true,useFindAndModify:true}).then(con=>console.log(con)).catch(err=>console.log(err));
const port = process.env.PORT || 3000;
//Starts server
const server=app.listen(port, () => { console.log(`Server running on port:${port}`); });

//Handler for Asynchronous/Promises Exceptions
process.on('unhandledRejection',err=>{
    console.log(`UNHANDLED REJECTION ...\n${err.name} : ${err.message}\nShutting down the app`);    
    server.close(()=>{
        process.exit(1);
    });
});
//For SIGTERM signal which heroku gives to site every 24 hrs to keep it in a good state..b
// has a bad impact sometimes request are unhandled and they just keep hanged ...so we need to shut down the server gracefully
process.on('SIGTERM',()=>{
    console.log('SIGTERM SIGNAL!!! Shutting down gracefully');
    server.close(()=>{
        console.log('Webapp processes terminated');
    }); 
});