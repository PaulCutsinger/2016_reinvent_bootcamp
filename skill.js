'use strict';
//v0.0.0

//dependencies
var AWS = require("aws-sdk");
var dynamodb = new AWS.DynamoDB();

//settings
var bDebug = true;

//variables
var stage = "";
var cachedWhatsNew = []; //simple cached version of what's new; will expire when function shutsdown
var logOutput = {};
var t; //a cache of our localized text strings from the resouces table; will expire when function shutsdown
var requiredTokens =[
  "Locale", "sorry","serviceUnknown","learnService","servicePrompt","servicePromptShort","learnPrompt",
  "helpAnythingElse","helpWhatsNew","helpTellMeAbout","helpLearnSomething","helpReprompt","welcomeCardTitle","welcome",
  "announcementReprompt","announcementCardTitle","noNewAnnouncements","joke","serviceDescriptionCardMoreInfo",
  "quizNotReady","learnRequestConfirmation","confirmPreamble","confirm","acknowledge","goodbye"];

var t = {
  "Locale": "en-US",
  "sorry": "I didn't follow.",
  "serviceUnknown":"I'm not familiar with " ,
  "learnService":"If you think I should learn more about it, say Learn More About ",
  "servicePrompt": "What service would you like me to describe? You can say things like S3 or dynamo d b",
  "servicePromptShort":"Which service would you like to know more about?",
  "learnPrompt":"What would you like me to learn how to do?",
  "helpAnythingElse": "What else can I help you with?",
  "helpWhatsNew":"If you say Whats New on AWS, I will tell you about the most recent AWS announcements, starting with the most recent announcement and working backwards.",
  "helpTellMeAbout":"If you say Tell Me About AWS Lambda, I will provide you with a high level description of AWS Lambda.  You can substitute any AWS service for AWS Lambda and I will tell you about that service instead.  For example, Tell Me about Elastic Beanstalk or Tell me about Code Deploy.",
  "helpLearnSomething":"You can also provide feedback on what other tasks you would like me to do, or information you would like me to provide by saying Learn something new.  I will then ask what you would like me to learn and then confirm I heard you correctly. ",
  "helpReprompt":"What can I help you with?",
  "welcomeCardTitle":"Cloud Ninja",
  "welcome":"I am a Cloud Ninja, here to answer your AWS questions.  You can say things like " +
      " What's New on AWS or tell me more about a specific service.  " +
      "You can also direct my ninja studies by saying learn something new.",
  "announcementReprompt":"Would you like me to mark this as heard, and to tell you the next announcement?",
  "announcementCardTitle":"Announcements",
  "noNewAnnouncements":"There are no new announcements since the last time you checked. " ,
  "joke":"I only know one cloud joke, I hope you like it.  Two no SQL developers walk into a bar...a few minutes later they walk out because they couldn't find a table.",
  "serviceDescriptionCardMoreInfo":"More information can be found at ",
  "quizNotReady":"I'm not quite ready to quiz you.  Check back later.",
  "learnRequestConfirmation":"You want me to learn more about ",
  "confirmPreamble":"OK, so let me confirm. ",
  "confirm":"Is that correct?",
  "acknowledge":"OK.  I'll look into that back at my dojo. ",
  "goodbye": "Good Bye"
};


// constants
var AppPrefix = "ASK-ABOUT";
var NewsTableName = "News";
var OldNewsTableName = "OldNews";
var ActivityTableName = "Activity";
var DefinitionTableName = "Definition";
var AppsTableName = "Apps";
var ResponsesTableName = "Resources";
var AliasTableName = "Alias";
var Context;






exports.handler = function (event, context) {
    try {
        Context=context;
        var functionName= context.invokedFunctionArn;
        stage = functionName.split(":")[functionName.split(":").length - 1];

        pushToSummary("event", event);
        logInfo("event", JSON.stringify(event));

        pushToSummary("context",context);
        logInfo("context", JSON.stringify(context));


        //ensure we have a valid AppId

        validateAppId(event,context,function(){
          getLocalizedResources(event,context,function(){
            reactToEventRequestType(event,context)
          });
        });

      } catch (e) {
          context.fail("Exception: " + e);
      }


};

function reactToEventRequestType (event, context) {
      console.log("in reactToEventRequestType");
        if (event.session.new) {
            onSessionStarted();
        }

        if (event.request.type === "LaunchRequest") {
            onLaunch(
                function callback(sessionAttributes, speechletResponse) {
                context.succeed(buildResponse(sessionAttributes, speechletResponse));
            });
        } else if (event.request.type === "IntentRequest") {
            onIntent(event.request,
                event.session,
                function callback(sessionAttributes, speechletResponse) {
                if (!sessionAttributes) {
                    context.succeed(buildEmptyResponse());
                } else {
                    context.succeed(buildResponse(sessionAttributes, speechletResponse));
                }
            });
        } else if (event.request.type === "SessionEndedRequest") {
            onSessionEnded(
                    function callback(sessionAttributes, speechletResponse) {
                context.succeed(buildResponse(sessionAttributes, speechletResponse));
            });
        }
      }



/**
 * Called when the session starts.
 */
function onSessionStarted() {
    //session started
    // nothing to do here
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(callback) {
    getWelcomeResponse(callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, session, callback) {
    var intent = intentRequest.intent,
        intentName = intentRequest.intent.name;


        logInfo("intent", JSON.stringify(intent));
        logInfo("session", JSON.stringify(session));

        // Dispatch to your skill's intent handlers
        if ("WhatsNewIntent" === intentName) {
            getWhatIsNew(intent, session, callback);
        } else if ("RandomInputIntent" === intentName) {
            if (!session.attributes || !session.attributes.lastRequest) {
                logInfo("RandomInputIntent switch", "There was no lastRequest value");
                if (!intent.slots || !intent.slots.RandomInput || !intent.slots.RandomInput.value) {
                    logInfo("RandomInput was empty", "<empty>");
                } else {
                    logInfo("RandomInput", intent.slots.RandomInput.value);
                }
                getWelcomeResponse(callback);
            } else {
                switch (session.attributes.lastRequest) {
                    case "DescribeService":
                        if (!intent.slots || !intent.slots.RandomInput || !intent.slots.RandomInput.value) {
                            //didn't follow response.  reprompt
                            callback(session.attributes,
                            buildSpeechletResponse(null, null,
                                t.sorry+" "+t.unknownService,
                                t.servicePrompt,
                                false));
                        } else {
                            getDescribeServiceResponse(intent, session, callback, intent.slots.RandomInput.value);
                        }
                        break;
                    case "WhatToLearn":
                        if (!intent.slots || !intent.slots.RandomInput || !intent.slots.RandomInput.value) {
                            //didn't follow response.  reprompt
                            callback(session.attributes,
                            buildSpeechletResponse(null, null,
                              t.sorry+" "+t.learnPrompt,
                              t.learnPrompt,
                                false));
                        } else {
                            getLearnSomethingResponse(intent, session, callback, null, intentRequest.timestamp, intent.slots.RandomInput.value);
                        }
                        break;
                    default:
                        //todo verify this is the right response to give
                        logError("RandomInputIntent switch", "Did not recognize last request (" + session.attributes.lastRequest + ") as needing random input.");
                        getWelcomeResponse(callback);
                }
            }

        } else if ("DescribeServiceIntent" === intentName) {
            getDescribeServiceResponse(intent, session, callback);
        } else if ("LearnSomethingIntent" === intentName) {
            getLearnSomethingResponse(intent, session, callback, null, null);
        } else if ("QuizMeIntent" === intentName) {
            getQuizMeResponse(intent, session, callback);
        } else if ("AMAZON.HelpIntent" === intentName) {
            getHelpResponse(callback);
        } else if ("AMAZON.StopIntent" === intentName) {
            //stop
            callback(null, null);
        } else if ("AMAZON.NoIntent" === intentName) {
            //no response
            if (!session.attributes || !session.attributes.lastRequest) {
                logInfo("NoIntent switch", "There was no lastRequest value");
                callback(null, null);
            } else {
                switch (session.attributes.lastRequest) {
                    case "WhatsNew":
                        callback({}, buildSpeechletResponse(null, null, t.howCanIHelp, t.howCanIHelp, false));
                        break;
                    case "WhatToLearn":
                        getLearnSomethingResponse(intent, session, callback, "no");
                        break;
                    default:
                        //todo verify this is the right response to give
                        logError("NoIntent switch", "Did not recognize last request (" + session.attributes.lastRequest + ") as needing a No.");
                        getWelcomeResponse(callback);
                }
            }
        } else if ("AMAZON.CancelIntent" === intentName) {
            //stop
            callback(null, null);
        } else if ("AMAZON.YesIntent" === intentName) {
            if (!session.attributes || !session.attributes.lastRequest) {
                logInfo("YesIntent switch", "There was no lastRequest value");
                getWelcomeResponse(callback);
            } else {
                switch (session.attributes.lastRequest) {
                    case "WhatsNew":
                        //write activity to db and get next announcement
                        var params = {
                            TableName: "ActivityRecord",
                            Item: {
                                "UserId": { "S": session.user.userId },
                                "ItemId": { "S": session.attributes.lastAnnouncementId }
                            }
                        };
                        dynamodb.putItem(params, function (error, data){
                            getWhatIsNew(intent, session, callback);
                        })
                        break;
                    case "WhatToLearn":
                        getLearnSomethingResponse(intent, session, callback, "yes", intentRequest.timestamp);
                        break;
                    default:
                        //todo verify this is the right response to give
                        logError("YesIntent switch", "Did not recognize last request (" + session.attributes.lastRequest + ") as needing a Yes.");
                        getWelcomeResponse(callback);
                }
            }
        } else {
            throw "Invalid intent";
        }

}

/**
 * Called when the user ends the session.
 * Is not called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(callback) {
    var goodbyeText = t.goodbye;
    callback({}, buildSpeechletResponse(null, null, goodbyeText, "", true));
}

// --------------- Functions that control the skill's behavior -----------------------
function getHelpResponse(callback) {
    var sessionAttributes = {};
    var cardTitle = null;

    //to keep the help response concise, we tell the customer about a random feature we support when they ask for help


    var speechOutput = randomHelp();
    var repromptText = randomHelp();

    var shouldEndSession = false;

    callback(sessionAttributes,
    buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));
}

function randomHelp(){
  var helpArray = [t.helpWhatsNew, t.helpTellMeAbout, t.helpLearnSomething];
  var helpIndex = Math.floor(Math.random() * helpArray.length);
  var speechOutput=" "+helpArray[helpIndex]+" ";
  return speechOutput;
}

function getWelcomeResponse(callback) {
    // If we wanted to initialize the session to have some attributes we could add those here.
    var sessionAttributes = {
        currentWhatsNew : 0
    };
    var cardTitle = t.welcomeCardTitle;
    var speechOutput = t.welcome;
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    //    var repromptText = "You can say things like What's new on AWS or tell me more about a specific service.";

    var repromptText = randomHelp();

    var shouldEndSession = false;

    callback(sessionAttributes,
    buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));
}

//gets the new info from the database
function getWhatIsNew(intent, session, callback) {

    var UserId = session.user.userId;

    logInfo("cache size", cachedWhatsNew.length);
    //build speech response from cache
    var lastWhatsNew = 0;
    if (!session.attributes || !session.attributes.lastWhatsNew) {
        //first time through
        lastWhatsNew = -1;
    }
    else {
        lastWhatsNew = parseInt(session.attributes.lastWhatsNew);
    }

    //populate cache from DDB, if not already cached
    if (cachedWhatsNew.length === 0) {
        var params = {
            TableName: AppPrefix + "-" + stage + "-" + NewsTableName
            };
        dynamodb.scan(params, function (error, data) {
            if (error) {
                console.log(error, error.stack);
            }
            else {
                //load the returned info
                var itemCount = data.Items.length;
                logInfo("returned data", itemCount);
                for (var i in data.Items) {
                    console.log("pushing item " + i);
                    cachedWhatsNew.push(data.Items[i]);
                    //todo: update to card title when that is added
                    console.log("pushed " + data.Items[i].SpeechDescription.S);
                }
                //sort results
                cachedWhatsNew.sort(function (a, b) {
                    //sort with newest date first
                    if (a.ReleaseDate.S < b.ReleaseDate.S) { return 11 };
                    if (a.ReleaseDate.S > b.ReleaseDate.S) { return -1 };
                    return 0;
                });
            }
            console.log("cache is built " + cachedWhatsNew.length);

            HandleWhatsNewRequest(lastWhatsNew, UserId, callback);
        });
    }
    else {
        HandleWhatsNewRequest(lastWhatsNew, UserId, callback);
    }
}

function HandleWhatsNewRequest(lastWhatsNew, UserId, callback) {
    logInfo("lastWhatsNew", lastWhatsNew);

    // call dynamodb to get info
    var params = {
        TableName: AppPrefix + "-" + stage + "-" + OldNewsTableName,
        KeyConditionExpression : "UserId = :userid",
        ExpressionAttributeValues: { ":userid": { "S": UserId } }
    };
    logInfo("ActivityRecord Params", JSON.stringify(params) );
    dynamodb.query(params, function (error, data) {

        var currentWhatsNew = lastWhatsNew + 1;
        var currentAnnouncementId = "";

        logInfo("ActivityRecord data", JSON.stringify(data));

        //determine the next announcement not yet read
        if (error) {
            console.log(error, error.stack);
        }
        else {
            //load the returned info
            var activityCount = data.Count;
            if (activityCount > 0) {
                logInfo("Activity Count", activityCount);
                logInfo("cachedWhatsNew.length", cachedWhatsNew.length);
                while (currentWhatsNew < cachedWhatsNew.length) {
                    // some previously recorded activity, check if current announcement was already read
                    currentAnnouncementId = cachedWhatsNew[currentWhatsNew].AnnouncementId.S;
                    logInfo("current announcement id", currentAnnouncementId);
                    var matched = false;
                    for (var i = 0; i < activityCount; i++) {
                        if (data.Items[i].ItemId.S == currentAnnouncementId) {
                            logInfo("Check of current announcement id", "match");
                            //current announcement already read.  increment and try again
                            currentWhatsNew++;
                            i = activityCount;
                            matched = true;
                        }
                    }
                    if (!matched) { break;}
                };

            } else {
                //no recorded activity -- should only get here the first time through
                logInfo("HandleWhatsNewRequest", "no recorded activity");
                currentWhatsNew = 0;
            }
        }

        logInfo("currentWhatsNew", currentWhatsNew);

        // return announcement
        var cardTitle = "";
        var repromptText = t.announcementReprompt;
        var sessionAttributes = {};
        var shouldEndSession = false;
        var speechOutput = "";
        var cardOutput = "";

        if (currentWhatsNew <= cachedWhatsNew.length - 1) {

        console.log("Getting entry " + currentWhatsNew + " from what's new cache");
        cardOutput += cachedWhatsNew[currentWhatsNew].CardDescription.S;

        //todo: add url to card
        //cardOutput += "\n";

        //todo: put announcement title as card title instead of what's new

        cardTitle = t.announcementCardTitle;

        speechOutput += cachedWhatsNew[currentWhatsNew].SpeechDescription.S;
        speechOutput += ". ";

        if (currentWhatsNew == cachedWhatsNew.length - 1) {
            // reading the last announcement
            // todo - this is a bit awkward because we don't know if there are more announcements to be read, so could offer another announcement
            // when there isn't one to be had.
            repromptText = t.announcementReprompt;
        }


            //more announcements to be read (potentially)
            speechOutput += repromptText;
            sessionAttributes = {
                lastWhatsNew : currentWhatsNew,
                lastRequest : "WhatsNew",
                lastAnnouncementId : cachedWhatsNew[currentWhatsNew].AnnouncementId.S
            };
        } else {
            //we're done with announcements
            repromptText = t.helpReprompt;
            speechOutput = t.noNewAnnouncements + randomHelp();

            sessionAttributes = {
                lastWhatsNew : lastWhatsNew,
                lastRequest : "WhatsNew",
            };
            cardTitle = null;
            cardOutput = null;
        }

        callback(sessionAttributes,
             buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
    });
}

function validateAppId(event, context, callback) {


  console.log("in validateAppId");
  var params = {
      TableName: AppPrefix + "-" + AppsTableName
      };
  dynamodb.scan(params, function (error, data) {
      if (error) {
          console.log(error, error.stack);
      }
      else {
          //console.log("the AppId table data is: "+ JSON.stringify(data));

          //We'll consider any appId in the table that matches the session data to be valid
          //you could choose to test for specific prod or test appids
          var isValid=false; //by default, we won't allow AppIds that we don't recognize

          //Always allow the AppId used in Lambda's Alexa Start Session Test Event
          if (data.Count==0){
            if (event.session.application.applicationId == "amzn1.echo-sdk-ams.app.[unique-value-here]") {
              isValid=true;
            }
          }

          //Compare the AppId in the db vs the one we see in the Lambda request from Alexa
          for (var i in data.Items) {
              if (event.session.application.applicationId == data.Items[i].AppId.S) {
                isValid=true;
              }
          }

          // fail if the AppId is not valid
          if (!isValid) {
            context.fail("Invalid Application ID - Be sure to add your AppId to DynamoDB or to the Lambda Test event");
          }


      }
      //console.log("AppId is valid: "+isValid);
      callback();

  });

}

function getLocalizedResources (event, context, callback) {
  var checkTokens = [];
  //console.log("in getLocalStrings");
  var params = {
      TableName: AppPrefix + "-" + ResponsesTableName
      };
  dynamodb.scan(params, function (error, data) {
      if (error) {
          console.log(error, error.stack);
      }
      else {
          console.log("the " + ResponsesTableName +" table data is: "+ JSON.stringify(data));
          //console.log(data.Items.welcome.S);
          var localeId=0;

          //Find the right localized resources for this locale by comparing the locale in the request to the locale in the resources table.
          for (var i = 0; i < data.Count; i++) {
            var requestLocale = "en-US"; // default to en-US if there is no locale passed in the request.
            if (event.request.locale) {requestLocale=JSON.stringify(event.request.locale);} //locale from request
            if (data.Items[i].Locale.S) {
              var itemLocale = JSON.stringify(data.Items[i].Locale.S);  // update locale to be from item
            } else {
              context.fail("Unable to find localized text in the resources DB table");
            }

            if (requestLocale == itemLocale) {localeId=i;}
          }

          //now get all the keys and values for this Locale
          var name;
          var entry;
          entry=data.Items[localeId];
          for (name in entry) {
            //console.log("key: "+ JSON.stringify(name));
            checkTokens.push(name);

            //console.log("value: "+ JSON.stringify(entry[name].S));
          }
          //console.log("c key: "+ checkTokens);
          //console.log("r key: "+ requiredTokens);
          arraysEqual(checkTokens, requiredTokens);



      }

      callback();

  });

}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length != b.length) return false;

  // If you don't care about the order of the elements inside
  // the array, you should sort both arrays here.
  a.sort();
  b.sort();

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      Context.fail("The list of string keys in the resources table does not exactly match the list of required tokens.")
      console.log("false "+i);
      return false;
    }
  }
  return true;
}
function getOfficialServiceName(spokenServiceName, callback) {
    //remove spaces to make lookup easier
    //force lowercase to also make lookup easier
    var nameToLookup = spokenServiceName.replace(/[ .]/g, "").toLowerCase();
    logInfo("nameToLookup", nameToLookup);

    var params = {
        TableName: AppPrefix + "-" + stage + "-" + AliasTableName,
        Key: { "AliasName": { "S": nameToLookup } }
    };
    logInfo("DDB params", JSON.stringify(params));

    dynamodb.getItem(params, function (error, data) {

        if (error) {
            logError(error, error.stack);
        } else {
            if (!data.Item) {
                //no match
                var speechOutput = t.serviceUnknown+" "+ spokenServiceName + ". " +
                    t.learnService +" " + spokenServiceName + ".";
                var repromptText = randomHelp();
                var sessionAttributes = {
                    lastRequest : "DescribeService"
                };
                var shouldEndSession = false;

                speechOutput += repromptText;
                callback(sessionAttributes,
         buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));
            } else {
                logInfo("returned data", JSON.stringify(data));
                var officialName = data.Item.OfficialName.S;

                if (officialName == "Joke") {
                    logInfo("Joke", "Telling a joke");
                    var speechOutput = t.joke;
                    var repromptText = randomHelp();
                    var sessionAttributes = { lastRequest: "DescribeService" };
                    var shouldEndSession = false;

                    speechOutput += repromptText;
                    callback(sessionAttributes,
                     buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));

                } else {
                    getServiceDescriptions(officialName, callback);
                }
            }
        }
    });
}

function getServiceDescriptions(officialName, callback) {

    //check cache for info
    // todo -- for now, assume no cache

    //if not in cache, fetch from dynamodb
    var params = {
        TableName: AppPrefix + "-" + stage + "-" + DefinitionTableName,
        Key: { "ServiceName": { "S": officialName } }
    };
    logInfo("DDB params", JSON.stringify(params));

    dynamodb.getItem(params, function (error, data) {
        //todo handle scenario where no match is found
        if (error) {
            logError(error, error.stack);
        }
        else {
            logInfo("returned data", JSON.stringify(data));

            var cardOutput = data.Item.CardDescription.S + "\n"+ t.serviceDescriptionCardMoreInfo + data.Item.CardURL.S;
            var speechOutput = data.Item.SSMLDescription.S;
            var repromptText = randomHelp();
            var sessionAttributes = { lastRequest: "DescribeService" };
            var cardTitle = officialName;
            var shouldEndSession = false;

            speechOutput += repromptText;
            callback(sessionAttributes,
         buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
        }
    });
}

function getDescribeServiceResponse(intent, session, callback, randomInput) {

    var spokenServiceName = intent.slots.ServiceName.value;
    var cardTitle = "";
    var repromptText = randomHelp();
    var sessionAttributes = {};
    var shouldEndSession = false;
    var speechOutput = "";
    var cardOutput = "";

    if (!spokenServiceName) {
        //check for random input
        if (!randomInput) {
            //prompt for service name
            sessionAttributes = { lastRequest: "DescribeService" };
            speechOutput = t.servicePromptShort;
            repromptText = speechOutput;

            callback(sessionAttributes,
                buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
        } else {
            //try the random input...maybe it'll work :)
            getOfficialServiceName(randomInput, callback);
        }
    } else {
        //convert the spoken word into the official name
        getOfficialServiceName(spokenServiceName, callback);
    }
}

function getQuizMeResponse(intent, session, callback) {

    var cardTitle = null;
    var repromptText = "";
    var sessionAttributes = {};
    var shouldEndSession = true;
    var speechOutput = t.quizNotReady;
    var cardOutput = "";

    callback(sessionAttributes,
         buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession));
}

function getLearnSomethingResponse(intent, session, callback, confirmed, timestamp, randomInput) {

    var cardTitle = "";
    var repromptText = "";
    var sessionAttributes = {};
    var shouldEndSession = false;
    var speechOutput = "";
    var cardOutput = "";
    var learningTopic = "";
    var topicLocation = "";

    logInfo("getLearnSomethingResponse", "starting");

    if (!session.attributes || !session.attributes.WhatToLearn) {
        if (!intent.slots || !intent.slots.WhatToLearn || !intent.slots.WhatToLearn.value) {
            //check randomInput
            if (!randomInput) {
                logInfo("getLearnSomethingResponse", "learning topic not specified");
                speechOutput = t.learnPrompt;
                repromptText = speechOutput;
                sessionAttributes = {
                    lastRequest: "WhatToLearn"
                };
                callback(sessionAttributes,
                    buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));
                return;
            } else {
                topicLocation = "random";
            }
        } else {
            topicLocation = "slots";
        }
    } else {
        topicLocation = "session";
    }

    logInfo("getLearnSomethingResponse", "finding learning topic");
    //prioritize the slot over session variable
    switch (topicLocation) {
        case "slots":
            logInfo("getLearnSomethingResponse", "learning topic in slots");
            learningTopic = intent.slots.WhatToLearn.value;
            break;
        case "session":
            logInfo("getLearnSomethingResponse", "learning topic in session attributes");
            learningTopic = session.attributes.WhatToLearn;
            break;
        case "random":
            logInfo("getLearnSomethingResponse", "learning topic in random input");
            learningTopic = randomInput;
            break;
        default:
            logInfo("getLearnSomethingResponse", "learning topic location somehow unknown...");
    }

    logInfo("learning topic", learningTopic);

    if (!confirmed) {
        //repeat back, ask for confirmation
        speechOutput = t.confirmPreamble+" "+t.learnRequestConfirmation +
                learningTopic +
                ". "+ t.confirm ;
        repromptText = t.learnRequestConfirmation +
                learningTopic +
                ". "+ t.confirm ;
        sessionAttributes = {
            lastRequest: "WhatToLearn",
            WhatToLearn: learningTopic
        };
    } else {
        //in confirmation step
        if (confirmed === "no") {
            speechOutput = t.sorry+" "+t.learnPrompt;
            repromptText = t.learnPrompt;
            sessionAttributes = {
                lastRequest: "WhatToLearn"
            };
        } else {
            // must be yes
            speechOutput = t.acknowledge+" "+ randomHelp();
            repromptText = randomHelp();
            //store in database
            AddToLearnList(learningTopic, session.user.userId, timestamp, function () {
                callback(sessionAttributes, buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));
            });
            return;
        }
    }
    callback(sessionAttributes,
         buildSpeechletResponse(null, null, speechOutput, repromptText, shouldEndSession));
}

function AddToLearnList(thingToLearn, userId, timestamp, callback) {
    //store thingToLearn, userId, timestamp into DDB
    var params = {
        TableName: AppPrefix + "-" + ActivityTableName,
        Item: {
            "userId": { "S": userId },
            "timestamp" : { "S": timestamp },
            "whatToLearn" : { "S": thingToLearn }
        }
    };
    logInfo("DDB params", JSON.stringify(params));
    dynamodb.putItem(params, function (error, data) {
        if (error) {
            logError(error, error.stack);
        } else {
            logInfo("response", JSON.stringify(data));
            logInfo("Added To Learn List:", thingToLearn);
        }
        callback();
    });
    logInfo("AddToLearnList", "exiting");
}





// --------------- Helpers that build all of the responses -----------------------

function buildSpeechletResponse(cardTitle, cardOutput, speechOutput, repromptText, shouldEndSession) {
    var response ="";
    if (!cardTitle) {
        response = {
            outputSpeech: {
                type: "SSML",
                ssml: "<speak>" + speechOutput + "</speak>"
            },
            reprompt: {
                outputSpeech: {
                    type: "SSML",
                    ssml: "<speak>" + repromptText + "</speak>"
                }
            },
            shouldEndSession: shouldEndSession
        };
    } else {
        response = {
            outputSpeech: {
                type: "SSML",
                ssml: "<speak>" + speechOutput + "</speak>"
            },
            card: {
                type: "Simple",
                title: cardTitle,
                content: cardOutput
            },
            reprompt: {
                outputSpeech: {
                    type: "SSML",
                    ssml: "<speak>" + repromptText + "</speak>"
                }
            },
            shouldEndSession: shouldEndSession
        };
    }
    pushToSummary("response",response);
    logSummary();
    return response;
}

function buildResponse(sessionAttributes, speechletResponse) {
    var response = {
        version: "1.0",
        sessionAttributes: sessionAttributes,
        response: speechletResponse
    };
    pushToSummary("response",response);
    logSummary();
    return response;
}

function buildEmptyResponse() {
    var response =  {
        version: "1.0",
        response: { "shouldEndSession": true }
    };
    pushToSummary("response",response);
    logSummary();
    return response;
}

function logInfo(source, message) {
    if (stage!="Prod") {
        console.log(source + ": " + message);
    }
}

function logError(source, message) {
    console.error(JSON.stringify(source) + ": " + JSON.stringify(message));
}

function pushToSummary(section, content) {
    logOutput[section] = content;
}

function logSummary() {
    console.info(JSON.stringify(logOutput));
}
