plugins {
    kotlin("jvm") version "2.0.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
    id("org.jetbrains.compose") version "1.7.3"
}

group = "lokal.experiments"
version = "0.1.0"

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.3")
}

tasks.test {
    useJUnitPlatform()
}

tasks.register<Exec>("buildNative") {
    onlyIf { System.getProperty("os.name").startsWith("Windows") }
    workingDir = projectDir
    commandLine("cmd", "/c", File(projectDir, "build-native.bat").absolutePath)
}

compose.desktop {
    application {
        mainClass = "lokal.wasapi.MainKt"
    }
}

tasks.configureEach {
    if (name == "run") dependsOn("buildNative")
}

tasks.register<JavaExec>("nativeSmoke") {
    dependsOn("buildNative", "classes")
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass = "lokal.wasapi.NativeSmokeKt"
}
