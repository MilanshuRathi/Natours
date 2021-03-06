const {promisify}=require('util');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const { request } = require('http');
const User = require(`${__dirname}/../models/userModel`);
const catchAsyncError=require(`${__dirname}/../utils/catchAsyncError`);
const AppError=require(`${__dirname}/../utils/AppError`);
const Email=require(`${__dirname}/../utils/email`);
//Util Methods
const sendToken=(id,user,statusCode,request,response)=>{
    const token=jwt.sign({id},process.env.JWT_SECRET_KEY,{expiresIn:process.env.JWT_EXPIREIN});    
    const cookieOptions={
        expires:new Date(Date.now()+process.env.JWT_COOKIE_EXPIREIN*24*60*60*1000),        
        httpOnly:true,
        secure:request.secure||request.headers['x-forwarded-proto']==='https'
    };    
    //Remove password of  user from output
    if(user)
        user.password=undefined;
    response.cookie('jwt',token,cookieOptions);
    response.status(statusCode).json({
        status:'success',
        token,
        user        
    });
}

//Export methods
exports.signUp = catchAsyncError(async(request, response, next) => {
    const newUser = await User.create({
        name:request.body.name,
        email:request.body.email,
        password:request.body.password,
        passwordConfirm:request.body.passwordConfirm        
    });    
    new Email(newUser,`${request.protocol}://${request.get('host')}/me`).sendWelcome();       
    sendToken(newUser._id,newUser,201,request,response);         
});
exports.login=catchAsyncError(async (request,response,next)=>{
    let {email,password}=request.body;
    if(!email||!password)
        return next(new AppError('Please provide your email and password',400));    
    const user=await User.findOne({email}).select('+password');           
    if(!user||!await user.correctPassword(password,user.password))
        return next(new AppError('Incorrect email or password',401));       
    sendToken(user._id,null,200,request,response);
});
exports.logout=(request,response)=>{
    response.cookie('jwt','loggedOut',{
        expires:new Date(Date.now()+5*1000),
        httpOnly:true
    });    
    response.status(200).json({
        status:'success',
        data:{
            message:'Logged out Successfully!'
        }
    });
}
exports.protect=catchAsyncError(async (request,response,next)=>{
    let token;    
    //Get Token and check if it's there
    if(request.headers.authorization&&request.headers.authorization.startsWith('Bearer'))
        token=request.headers.authorization.split(' ')[1]; 
    else if(request.cookies.jwt)
        token=request.cookies.jwt;   
    if(!token)
        return next(new AppError('You are not logged in!!..Please login to get access.',401));
    else if(token==='loggedOut')
        return response.redirect('/login');
    //Verify the token and check if it is manipulated or not
    const decoded=await promisify(jwt.verify)(token,process.env.JWT_SECRET_KEY);    
    //decoded:-this will return the payload of user to whom the token was alloted which contains the user's id.
    //Now,Check if user still exists or not 
    const currentUser=await User.findById(decoded.id);
    if(!currentUser)
        return next(new AppError('The user belonging to this token does no longer exist.',401));
    //Now,check if user changed his password after ...allotment of JWT or not...if yes..then deny the accesss     
    if(currentUser.isPasswordChanged(decoded.iat*1000))
        return next(new AppError('User recently changed password! Please log in again.', 401));
    request.user=currentUser;
    response.locals.user=currentUser;
    next();
});
//Only to check if user is logged in or not
exports.isLoggedin=async (request,response,next)=>{    
    //Check if cookie has a jwt or not ..if not then user is not logged in 
    try{
        if(request.cookies.jwt){
            const decoded=await promisify(jwt.verify)(request.cookies.jwt,process.env.JWT_SECRET_KEY);    
        //decoded:-this will return the payload of user to whom the token was alloted which contains the user's id.
        //Now,Check if user still exists or not 
            const currentUser=await User.findById(decoded.id);
            if(!currentUser)
                return next();
        //Now,check if user changed his password after ...allotment of JWT or not...if yes..then deny the accesss     
            if(currentUser.isPasswordChanged(decoded.iat*1000))
                return next();                       
            response.locals.user=currentUser;//assiging user to request.locals for the pug templates to check if user is logged in or not 
            next();
        } 
        else       
            next();
    }   
    catch(err){
        next();
    }
};
exports.restrictTo=(...roles)=>(request,response,next)=>{
    //roles=['admin],'lead-guid'];
    if(!roles.includes(request.user.role))
        return next(new AppError('You don\'t have permission to perform this action',403));
    next();
};
exports.forgotPassword=catchAsyncError(async (request,response,next)=>{
    //Get user from email       
    const user=await User.findOne({email:request.body.email});
    if(!user)
        return next(new AppError('No such user existe with this email',404));
    //Get reset token from User Model
    const resetToken=await user.createPasswordResetToken();
    await user.save({validateBeforeSave:false});    
    // next();      
    try{        
        const resetUrl=`${request.protocol}://${request.get('host')}/resetPassword/${resetToken}`;
        new Email(user,resetUrl).sendResetPassword();
        response.status(200).json({
            status:'success',
            message:'Token mail is sent.'
        });
    }
    catch(err){
        user.passwordResetToken=undefined;
        user.passwordResetExpire=undefined;
        await user.save({validateBeforeSave:false});
        return next(new AppError('Failed to send E-mail,Try again later',500));
    }
});
exports.resetPassword=catchAsyncError(async(request,response,next)=>{
    //Hash the resetToken which we got in the url ...to compare it to the passwordResetToken(hashed already) in the database
    const hashedToken=crypto.createHash('sha256').update(request.params.token).digest('hex');    
    const user=await User.findOne({passwordResetToken:hashedToken,passwordResetExpire:{$gt:Date.now()}});
    if(!user)
        return next(new AppError('Token is invalid or expired',400));
    //Updating password of the user and deleting passwordResetToken and passwordResetExpire from the database
    user.password=request.body.password;
    user.passwordConfirm=request.body.passwordConfirm;
    user.passwordResetToken=undefined;
    user.passwordResetExpire=undefined;
    await user.save();//running the validators this time because we wanna check if user's provided passwords match or not
    //Logging the user in by giving the token
    //we also change the passwordChangedAt in the database in the meantime ...to keep track of passwordChanged times     
    sendToken(user._id,null,200,request,response);
});
exports.updatePassword=catchAsyncError(async(request,response,next)=>{
    //check if user is logged in and authorized to perform this action
    const user=await User.findById(request.user._id).select('+password');
    //Confirm user's current password 
    if(!await user.correctPassword(request.body.passwordCurrent,user.password))
        return next(new AppError('Your current password is wrong',401));
    //If all these pass then update password
    user.password=request.body.password;
    user.passwordConfirm=request.body.passwordConfirm;
    await user.save();//here we will not disable validators because we wanna confirm the passwords
    /* In this type of methods where we have to save details or update passwords we can't use findOneandUpdate or findByIdandUpdate 
    because ..they can;t access 'this' in the schema and mongoose middlewares */
    
    //At last assigning token to the user and logging him/her in   
    sendToken(user._id,null,200,request,response);
});
