var properties = require(process.cwd() + '/properties/properties');
var methods;
var restify = require('restify');
var speakeasy = require('speakeasy');
var mailer = require(process.cwd() + '/services/mailer');
var sms = require(process.cwd() + '/services/sms');
var qrCode = require('qrcode-npm')
var userDb_controller = require(process.cwd() + '/controllers/user/' + properties.esup.userDb);
var mongoose = require('mongoose');
var connection;

exports.initialize = function(callback) {
    connection = mongoose.createConnection('mongodb://' + properties.esup.mongodb.address + '/' + properties.esup.mongodb.api_db, function(error) {
        if (error) {
            console.log(error);
        } else {
            initiatilize_user_model();
            methods = require(process.cwd() + '/methods/methods');
            if (typeof(callback) === "function") callback();
        }
    });
}

/** User Model **/
var UserModel;

function initiatilize_user_model() {
    var Schema = mongoose.Schema;

    var UserSchema = new Schema({
        uid: {
            type: String,
            required: true,
            unique: true
        },
        simple_generator: {
            code: String,
            validity_time: Number,
            active: {
                type: Boolean,
                default: false
            },
            transport: {
                sms: {
                    type: Boolean,
                    default: false
                },
                mail: {
                    type: Boolean,
                    default: false
                },
            }
        },
        bypass: {
            codes: Array,
            used_codes: { type: Number, default: 0 },
            active: {
                type: Boolean,
                default: false
            },
            transport: {
                sms: {
                    type: Boolean,
                    default: false
                },
                mail: {
                    type: Boolean,
                    default: false
                },
            }
        },
        google_authenticator: {
            secret: Object,
            window: Number,
            active: {
                type: Boolean,
                default: false
            },
            transport: {
                sms: {
                    type: Boolean,
                    default: false
                },
                mail: {
                    type: Boolean,
                    default: false
                },
            }
        },
    });

    connection.model('User', UserSchema, 'User');
    UserModel = connection.model('User');
}

function create_user(){

}

/**
 * Retourne l'utilisateur mongo
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function find_user(req, res, callback) {
    var response = {
        "code": "Error",
        "message": properties.messages.error.user_not_found
    };
    UserModel.find({
        'uid': req.params.uid
    }).exec(function(err, data) {
        if (data[0]) {
            if (typeof(callback) === "function") callback(data[0]);
        } else {
            res.send(response);
        }
    });
}

/**
 * Sauve l'utilisateur
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.save_user=function(user, callback) {
    user.save(function() {
        if (typeof(callback) === "function") callback();
    })
}

/**
 * Envoie le code via le transport == req.params.transport
 * Retourne la réponse du service mail
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.transport_code = function(code, req, res, next) {
    switch (req.params.transport) {
        case 'mail':
            userDb_controller.send_mail(req, res, function(mail) {
                mailer.send_code(mail,code, res);
            });
            break;
        case 'sms':
            userDb_controller.send_sms(req, res, function(num) {
                sms.send_code(num, code, res);
            });
            break;
        default:
            res.send({
                code: 'Error',
                message: properties.messages.error.unvailable_method_transport
            });
            break;
    }
}


/**
 * Renvoie l'utilisateur avec l'uid == req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.get_user = function(req, res, next) {
    find_user(req, res, function(user){
        var response = {};
        response.code = 'Ok';
        response.message = '';
        response.user = {};
        response.user.google_authenticator = {};
        response.user.google_authenticator.active = user.google_authenticator.active;
        response.user.simple_generator = {};
        response.user.simple_generator.active = user.simple_generator.active;
        response.user.bypass = {};
        response.user.bypass.active = user.bypass.active;
        response.user.bypass.available_code = user.bypass.codes.length;
        response.user.bypass.used_code = user.bypass.used_codes;
        response.user.matrix = user.matrix;
        // response.user.matrix.active = user.matrix.active;
        res.send(response);
    });
};

/**
 * Envoie un code à l'utilisateur avec l'uid == req.params.uid et via la method == req.params.method
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.send_code = function(req, res, next) {
    console.log("send_code :" + req.params.uid);
    if (properties.esup.methods[req.params.method]) {
        find_user(req, res, function(user) {
            if (user[req.params.method].active && properties.esup.methods[req.params.method].activate && methods[req.params.method]) {
                methods[req.params.method].send_code(user, req, res, next);
            } else {
                res.send({
                    code: 'Error',
                    message: properties.messages.error.method_not_found
                });
            }
        });
    }
};

/**
 * Vérifie si le code fourni correspond à celui stocké en base de données
 * si oui: on retourne un réponse positive et on supprime l'otp de la base de donnée
 * sinon: on renvoie une erreur 401 InvalidCredentialsError
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.verify_code = function(req, res, next) {
    find_user(req, res, function(user) {
        verify_simple_generator(req, res, function(req, res) {
            verify_google_authenticator(req, res, function() {
                verify_bypass(req, res, function() {
                    res.send({
                        "code": "Error",
                        "message": properties.messages.error.invalid_credentials
                    });
                });
            });
        });
    });
};


/**
 * Vérifie si le code fourni correspond à celui stocké en base de données
 * si oui: on retourne un réponse positive et on supprime l'otp de la base de donnée
 * sinon: on renvoie une erreur 401 InvalidCredentialsError
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function verify_simple_generator(req, res, next) {
    find_user(req, res, function(user) {
        if (user.simple_generator.active && properties.esup.methods.simple_generator.activate) {
            if (user.simple_generator.code == req.params.otp) {
                if (Date.now() < user.simple_generator.validity_time) {
                    delete user.simple_generator.code;
                    delete user.simple_generator.validity_time;
                    user.save(function(){
                        res.send({
                            "code": "Ok",
                            "message": properties.messages.success.valid_credentials
                        });
                    });
                } else {
                    next(req, res);
                }
            } else {
                next(req, res);
            }
        } else {
            next(req, res);
        }
    });
};


/**
 * Vérifie si le code fourni correspond à celui stocké en base de données
 * si oui: on retourne un réponse positive et on supprime l'otp de la base de donnée
 * sinon: on renvoie une erreur 401 InvalidCredentialsError
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function verify_bypass(req, res, next) {
    find_user(req, res, function(user) {
        if (user.bypass.active && properties.esup.methods.bypass.activate) {
            if (user.bypass.codes) {
                var checkOtp = false;
                var codes = user.bypass.codes;
                for (code in codes) {
                    if (user.bypass.codes[code] == req.params.otp) {
                        checkOtp = true;
                        codes.splice(code, 1);
                        user.bypass.codes = codes;
                        user.bypass.used_codes += 1;
                    }
                }
                if (checkOtp) {
                    user.save(function(){
                        res.send({
                            "code": "Ok",
                            "message": properties.messages.success.valid_credentials
                        });
                    });
                } else {
                    next(req, res);
                }
            } else {
                next(req, res);
            }
        } else {
            next(req, res);
        }
    });
};



/**
 * Vérifie si l'otp fourni correspond à celui généré
 * si oui: on retourne un réponse positive
 * sinon: on renvoie une erreur 401 InvalidCredentialsError
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function verify_google_authenticator(req, res, next) {
    var checkSpeakeasy = false;
    find_user(req, res, function(user) {
        if (user.google_authenticator.active && properties.esup.methods.google_authenticator.activate) {
            var transport_window = 0;
            checkSpeakeasy = speakeasy.totp.verify({
                secret: user.google_authenticator.secret.base32,
                encoding: 'base32',
                token: req.params.otp,
                window: user.google_authenticator.window
            });
            if (checkSpeakeasy) {
                user.google_authenticator.window = properties.esup.methods.google_authenticator.default_window;
                user.save(function() {
                    res.send({
                        "code": "Ok",
                        "message": properties.messages.success.valid_credentials
                    });
                });
            } else {
                next(req, res);
            }
        } else {
            next(req, res);
        }
    });
};


/**
 * Génére un nouvel attribut d'auth (secret key ou matrice ou bypass codes)
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.generate = function(req, res, next) {
    switch (req.params.method) {
        case 'google_authenticator':
            generate_google_authenticator(req, res, next);
            break;
        case 'simple_generator':
            res.send({
                "code": "Error",
                "message": properties.messages.error.unvailable_method_operation
            });
            break;
        case 'bypass':
            generate_bypass(req, res, next);
            break;
        default:
            res.send({
                "code": "Error",
                "message": properties.messages.error.method_not_found
            });
            break;
    }
};

/**
 * Retourne la réponse de la base de donnée suite à l'association d'un nouveau secret à l'utilisateur.
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function generate_google_authenticator(req, res, next) {
    if (properties.esup.methods.google_authenticator.activate) {
        find_user({
            'uid': req.params.uid
        }, res, function(user) {
            user.google_authenticator.secret = speakeasy.generateSecret({ length: 16 });
            user.save(function() {
                var response = {};
                var qr = qrCode.qrcode(4, 'M');
                qr.addData(user.google_authenticator.secret.otpauth_url);
                qr.make();
                response.code = 'Ok';
                response.message = user.google_authenticator.secret.base32;
                response.qrCode = qr.createImgTag(4);
                res.send(response);
            });
        });
    } else res.send({
        code: 'Error',
        message: properties.messages.error.method_not_found
    });
};


/**
 * Retourne la réponse de la base de donnée suite à la génération de nouveau bypass codes
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function generate_bypass(req, res, next) {
    if (properties.esup.methods.bypass.activate) {
        find_user({
            'uid': req.params.uid
        }, res, function(user) {
            var codes = new Array();
            for (var it = 0; it < properties.esup.methods.bypass.codes_number; it++) {
                switch (properties.esup.methods.simple_generator.code_type) {
                    case "string":
                        codes.push(simple_generator.generate_string_code(properties.esup.methods.bypass.code_length));
                        break;
                    case "digit":
                        codes.push(simple_generator.generate_digit_code(properties.esup.methods.bypass.code_length));
                        break;
                    default:
                        codes.push(simple_generator.generate_string_code(properties.esup.methods.bypass.code_length));
                        break;
                }
            }
            user.bypass.codes = codes;
            user.save(function() {
                res.send({
                    code: "Ok",
                    message: "",
                    codes : codes

                });
            });
        });
    } else res.send({
        code: 'Error',
        message: properties.messages.error.method_not_found
    });
};

/**
 * Supprime l'attribut d'auth (secret key ou matrice ou bypass codes)
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.delete_method_secret = function(req, res, next) {
    switch (req.params.method) {
        case 'google_authenticator':
            delete_google_authenticator_secret(req, res, next);
            break;
        case 'simple_generator':
            res.send({
                "code": "Error",
                "message": properties.messages.error.unvailable_method_operation
            });
            break;
        case 'bypass':
            delete_bypass_codes(req, res, next);
            break;
        default:
            res.send({
                "code": "Error",
                "message": properties.messages.error.method_not_found
            });
            break;
    }
};

/**
 * Supprime le secret de l'utilisateur et désactive la méthode
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function delete_google_authenticator_secret(req, res, next) {
    find_user(req, res, function(user) {
        user.google_authenticator.active = false;
        user.google_authenticator.secret={};
        user.save(function() {
            console.log("delete google auth secret "+user.uid);
            res.send({
                "code": "Ok",
                "message": 'Secret removed'
            });
        });
    });
};

/**
 * Supprime le secret de l'utilisateur et désactive la méthode
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function delete_bypass_codes(req, res, next) {

    find_user(req, res, function(user) {
        user.bypass.active = false;
        user.bypass.codes = [];
        user.save(function() {
            console.log("delete bypass codes "+user.uid);
            res.send({
                "code": "Ok",
                "message": 'Codes removed'
            });
        });
    });
};

/**
 * Renvoie le secret de l'utilisateur afin qu'il puisse l'entrer dans son appli smartphone
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.get_google_authenticator_secret = function(req, res, next) {
    find_user(req, res, function(user) {
        var response = {};
        var qr = qrCode.qrcode(4, 'M');
        qr.addData(user.google_authenticator.secret.otpauth_url);
        qr.make();
        response.code = 'Ok';
        response.message = user.google_authenticator.secret.base32;
        response.qrCode = qr.createImgTag(4);

        res.send(response);
    });
};


/**
 * Renvoie les méthodes activées de l'utilisateur
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.get_activate_methods = function(req, res, next) {
    find_user(req, res, function(user) {
        var response = {};
        var result = {};
        for (method in properties.esup.methods) {
            if (properties.esup.methods[method].activate) {
                if(!user[method].active)result[method] = user[method].active;
                else result[method] = properties.esup.methods[method];
            }
        }
        response.code = "Ok";
        response.message = properties.messages.success.methods_found;
        response.methods = result;
        res.send(response);
    });

};


/**
 * Active la méthode l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.activate_method = function(req, res, next) {
    console.log(req.params.uid + " activate_method " + req.params.method);
    switch (req.params.method) {
        case 'google_authenticator':
            activate_google_authenticator(req, res, next);
            break;
        case 'simple_generator':
            activate_simple_generator(req, res, next);
            break;
        case 'bypass':
            activate_bypass(req, res, next);
            break;
        default:
            res.send({
                "code": "Error",
                "message": properties.messages.error.method_not_found
            });
            break;
    }
};

/**
 * Active la méthode google auth pour l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function activate_google_authenticator(req, res, next) {
    find_user(req, res, function(user) {
        user.google_authenticator.active = true;
        user.save(function() {
            res.send({
                "code": "Ok",
                "message": ""
            });
        });
    });
};


/**
 * Active la méthode simple_generator pour l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function activate_simple_generator(req, res, next) {
    find_user(req, res, function(user) {
        user.simple_generator.active = true;
        user.save(function() {
            res.send({
                "code": "Ok",
                "message": ""
            });
        });
    });
};

/**
 * Active la méthode bypass pour l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function activate_bypass(req, res, next) {
       find_user(req, res, function(user) {
        user.bypass.active = true;
        user.save(function() {
            res.send({
                "code": "Ok",
                "message": ""
            });
        });
    });
};


/**
 * Désctive la méthode l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
exports.deactivate_method = function(req, res, next) {
    console.log(req.params.uid + " deactivate_method " + req.params.method);
    switch (req.params.method) {
        case 'google_authenticator':
            deactivate_google_authenticator(req, res, next);
            break;
        case 'simple_generator':
            deactivate_simple_generator(req, res, next);
            break;
        case 'bypass':
            deactivate_bypass(req, res, next);
            break;
        default:
            res.send({
                "code": "Error",
                "message": properties.messages.error.method_not_found
            });
            break;
    }
};

/**
 * Désactive la méthode google auth pour l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function deactivate_google_authenticator(req, res, next) {
    find_user(req, res, function(user) {
        user.google_authenticator.active = false;
        user.save(function() {
            res.send({
                "code": "Ok",
                "message": ""
            });
        });
    });
};


/**
 * Désactive la méthode simple_generator pour l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function deactivate_simple_generator(req, res, next) {
    find_user(req, res, function(user) {
        user.google_authenticator.active = false;
        user.save(function() {
            res.send({
                "code": "Ok",
                "message": ""
            });
        });
    });
};


/**
 * Désactive la méthode bypass pour l'utilisateur ayant l'uid req.params.uid
 *
 * @param req requete HTTP contenant le nom la personne recherchee
 * @param res response HTTP
 * @param next permet d'appeler le prochain gestionnaire (handler)
 */
function deactivate_bypass(req, res, next) {
    find_user(req, res, function(user) {
        user.google_authenticator.active = false;
        user.save(function() {
            res.send({
                "code": "Ok",
                "message": ""
            });
        });
    });
};

/**
 * Drop Users
 */
exports.drop = function(req, res, next) {
    UserModel.remove({}, function(err, data) {
        if (err) console.log(err);
        console.log('users removed');
        res.send(data);
    });
};