# Android build/test toolbox: JDK 17 + Android SDK (platform 36, build-tools 36).
# Used by scripts/android.sh on the Dev server. In Android Studio you don't need this.
FROM eclipse-temurin:17-jdk-jammy

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

ARG CMDLINE_TOOLS=commandlinetools-linux-16111833_latest.zip
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p $ANDROID_HOME/cmdline-tools \
  && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/$CMDLINE_TOOLS \
  && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
  && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
  && rm /tmp/tools.zip \
  && yes | sdkmanager --licenses >/dev/null \
  && sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" "build-tools;35.0.0" >/dev/null \
  && chmod -R a+rX $ANDROID_HOME
