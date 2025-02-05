# Eliza Remx Client

The purpose of this client is to tip creators on Remx.  Its main action is to run a loop that checks for new moments and interacts with that content on Remx, and to then tip the creator of the moment under certain conditions.

When checking a new moment, the client will:
* evaluate the image related to the moment
* if the image is not a video, it will:
  * add a comment to the moment
  * add a like to the moment
  * follow the creator
  * tip the creator if certain conditions are met
    * they are human-verified
    * we have enough balance to tip $1
    * we have not tipped the creator in the last 24 hours
    * we have not tipped the creator more than the daily limit

### TODO: V0
- [ ] Only tip human-verified creators
- [x] Set up a production environment to run the agent
      * set up in dev, we just need to duplicate in production later today.

### TODO: V1
- [ ] change how we check if we've seen a moment before to include if we've already liked the moment
      * this should be available in the reaction when loading the moment
- [ ] Add a process that checks the balance periodically and if the balance is low, ask for more funds somehow
      - run hourly and check if the balance is sufficient for 100 tips of $1 in the next 24 hours.
      - if not, ask for more funds
      - if yes, do nothing
- [ ] Set up a twitter client for the agent
- [ ] Add support for videos
    - see https://cookbook.openai.com/examples/gpt_with_vision_for_video_understanding
    - for videos with audio, we might need to use this: https://platform.openai.com/docs/guides/speech-to-text
    - use ffmpeg to extract the audio from the video
    - use the speech-to-text API to transcribe the audio
    - if its just music (no vocals) - what can we do?

### DONE:

- [x] Avoid commenting on moments that have already been commented on. Perhaps if already liked by us then skip further actions
- [x] if the process runs for more than 1 hour our auth token expires and we need to re-authenticate
- [x] Add a comment to the moment
- [x] Add a like to the moment
- [x] Add follow the creator
- [x] Add tip creator
- [x] Filter out moments that have videos (not supported yet)
- [x] Add our own ImageService that
      - allows for specifying a different prompt for analyzing the image
