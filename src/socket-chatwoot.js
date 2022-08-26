// import { Stomp } from '@stomp/stompjs';
import { EventEmitter } from 'events';

/*
  This implementation mimics the SocketIO implementation and adapts chatwoot socket's protocal
*/
export default (function (socketUrl, customData, _path, options) {
  var is_requested = false;
  return (socketUrl, customData, _path, options) => {
    if (is_requested){
      // This is the prevention, to project our backend, for case improper redering that leads to instantiate
      // more than one socket instance, in worse case there will infinite number of requests to socket connection
      console.log("Opps! This seems to be very bad (infinite loop).")
      return
    }
    is_requested = true
    var session_id;
    const CONTACT_IDENTIFIER = 'contactIdentifier'
    const CONTACT_CONVERSTION = 'contactConverstion'
    const inboxIdentifier = options.inboxIdentifier
    const chatwootAPIUrl = options.chatwootAPIUrl

    window.WebSocket = window.WebSocket || window.MozWebSocket;
    const socket = new WebSocket(socketUrl);

    const socketProxy = new EventEmitter();

    const create_UUID = () => {
        var dt = new Date().getTime();
        var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = (dt + Math.random()*16)%16 | 0;
            dt = Math.floor(dt/16);
            return (c=='x' ? r :(r&0x3|0x8)).toString(16);
        });
        return uuid;
    }

    const setUpContact = async () => {
      return new Promise((resolve, reject) => {
        var xhttp = new XMLHttpRequest();
        xhttp.open("POST", chatwootAPIUrl + "inboxes/"+inboxIdentifier+"/contacts");
        xhttp.onload = function(){
          resolve(JSON.parse(xhttp.responseText));
        }
        xhttp.send();
      });
    }

    const setUpConversation = (contactIdentifier) => {
      return new Promise((resolve, reject) => {
        var xhttp = new XMLHttpRequest();
        xhttp.open("POST", chatwootAPIUrl + "inboxes/"+inboxIdentifier+"/contacts/"+contactIdentifier+"/conversations", false);
        xhttp.onload = function(){
          resolve(JSON.parse(xhttp.responseText));
        }
        xhttp.send();
      })
    }

    // existent risk is pubsub_token (session_id) has been changed while localStorage still stores the invalid one
    const handle_not_confirming = (() => {
      const WAITING_THRESHOLD = 3;
      // only execute once
      var is_triggered = false;
      // count times of ping
      var counter = 0;
      var is_confirmed = false;

      return (to_confirm = false) => {
        if (is_confirmed){
          return;
        }

        if (to_confirm){
          console.log('confirmed: ', to_confirm)
          is_confirmed = to_confirm;
          return;
        }

        if (is_triggered){
          console.log('skip')
          return;
        }

        if (counter < WAITING_THRESHOLD){
          counter++;
          console.log('waiting server to confirm, counter: ', counter)
          console.log('is_confirmed: ', is_confirmed)
        } else {
          is_triggered = true;
          on_session_request({session_id: null});
        }
      }
    })();

    socket.onopen = function () {
      socketProxy.connected = true;
      socketProxy.id = create_UUID();
      socketProxy.customData = customData;
    };

    // most important part - incoming messages
    socket.onmessage = (message) => {
        // try to parse JSON message. Because we know that the server always returns
        // JSON this should work without any problem but we should make sure that
        // the massage is not chunked or otherwise damaged.
        try {
            var json = JSON.parse(message.data);
        } catch (e) {
            console.log('This doesn\'t look like a valid JSON: ', message.data);
            return;
        }

        if (json.type === 'welcome') {
          socketProxy.emit('connect')
        } else if (json.type === 'ping') {
          handle_not_confirming()
        } else if (json.type === 'confirm_subscription') {
          socketProxy.emit('session_confirm', {session_id: session_id})
          handle_not_confirming(true)
        }else if (json.message.event === 'message.created') {
          console.log('here comes message', json);
          if(json.message.data.message_type === 1)
          {
            const message = {text: json.message.data.content}
            socketProxy.emit('bot_uttered', message);
          }
        } else {
          console.log('Hmm..., I\'ve never seen JSON like this: ', json);
        }
    };

    socket.onclose = () => {
      // eslint-disable-next-line no-console
      socketProxy.connected = false;
      // eslint-disable-next-line no-console
      console.log('Closed socket connection');
      socketProxy.emit('disconnect');
    }

    socket.onerror = () => {
      socketProxy.onerror()
    }

    socketProxy.on('user_uttered', (data) => {
      // send message
      var xhttp = new XMLHttpRequest();
      const contactIdentifier = localStorage.getItem(CONTACT_IDENTIFIER)
      const contactConverstion = localStorage.getItem(CONTACT_CONVERSTION)
      xhttp.open(
        "POST",
        chatwootAPIUrl + "inboxes/"+inboxIdentifier+"/contacts/"+contactIdentifier+"/conversations/"+contactConverstion+"/messages",
        false);
      xhttp.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      xhttp.send(JSON.stringify({content: data.message}));
    });

    const on_session_request = async (data) => {
      // check whether we have a pubsub token and contact identifier or else set one
      var contactIdentifier;
      session_id = data.session_id;
      if (!session_id){
        const contact = await setUpContact();
        session_id = contact.pubsub_token;
        contactIdentifier = contact.source_id;
        localStorage.setItem(CONTACT_IDENTIFIER, contactIdentifier)

        const conversation = await setUpConversation(contactIdentifier);
        localStorage.setItem(CONTACT_CONVERSTION, conversation.id)

      } else {
        contactIdentifier = localStorage.getItem(CONTACT_IDENTIFIER)
      }

      // first we want users to subscribe to the chatwoot webhooks
      socket.send(JSON.stringify({
        command:"subscribe",
        identifier: "{\"channel\":\"RoomChannel\",\"pubsub_token\":\""+session_id+"\"}",
      }));
    }
    socketProxy.on('session_request', on_session_request);

    socketProxy.onerror = (error) => {
      // eslint-disable-next-line no-console
      console.log(error);
    };

    socketProxy.close = () => {
      socket.close();
    };

    return socketProxy;
  }
})()
