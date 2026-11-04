# kotlinx.serialization: keep generated serializers for API models.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers @kotlinx.serialization.Serializable class snowsig.music.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class snowsig.music.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit interfaces are used through reflection.
-keep,allowobfuscation interface snowsig.music.data.api.** { *; }
-keepattributes Signature, Exceptions
