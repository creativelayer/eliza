

TODO:
- [ ] How do we run this in production?
- [x] Add a comment to the moment
- [x] Add a like to the moment
- [x] Add follow the creator
- [ ] Add tip creator
- [ ] Filter out moments that have videos (not supported yet)
- [ ] Add our own ImageService that
      - allows for specifying a different prompt for analyzing the image
      - supports videos and GIFsas well as images
      - see https://cookbook.openai.com/examples/gpt_with_vision_for_video_understanding
      - for videos with audio, we might need to use this: https://platform.openai.com/docs/guides/speech-to-text
        - use ffmpeg to extract the audio from the video
        - use the speech-to-text API to transcribe the audio
        - if its just music (no vocals) - what can we do?
- [ ] if the process runs for more than 1 hour our auth token expires and we need to re-authenticate
- [ ] Add a process that checks the balance periodically and if the balance is low, ask for more funds somehow
      - run hourly and check if the balance is sufficient for 100 tips of $1 in the next 24 hours.
      - if not, ask for more funds
      - if yes, do nothing
