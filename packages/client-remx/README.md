
Moment Memory:
 id: moment.id + agentId
 userId: moment.accountId
 agentId: agentId
 roomId: specific to the author of the moment, i.e. moment.accountId
 content: {
    text: moment.title + '\n' +moment.description
    action: ?
    source: 'remx'
    url: share url for the moment
    attachments: [moment.image ]
    liked: true | false
    tipped: 0 +?
    comments: ""
 }
 createdAt: moment.createdAt
 embedding: getEmbeddingZeroVector(),

Moment Action:
if we like the moment, then
* call the like api
* generate a comment for the moment and call the comment api
* tip the author of the moment if
- we have enough funds
    - provider that injects the current Remx balance for the agent into the context
- we have not used our daily tip limit
    - provider that injects the Remx daily tip limit for the agent into the context
    - provider that injects the amount tipped today for the agent into the context
- we have not tipped the author yet today
    - provider that injects the amount tipped to the author today by the agent into the context


initialize the last seen moment from cache

every X minutes, load the latest moments from remx up to the last seen moment or everything on sale now?
- check if the moment is in the agent memory and add it if not
- cache last seen moment id
- decide if we want to take action on the moment



At some later point, we want to take actions on moments that the agent likes by:
* tweeting about the moment
* tweeting a summary of several moments that were liked since the previous tweet
* promote an artist by featuring several of their moments
