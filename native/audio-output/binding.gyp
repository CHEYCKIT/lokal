{
  "targets": [{
    "target_name": "lokal_audio",
    "sources": ["output.cc"],
    "defines": ["NAPI_VERSION=6", "MA_NO_DECODING", "MA_NO_ENCODING", "MA_NO_RESOURCE_MANAGER", "MA_NO_NODE_GRAPH", "MA_NO_ENGINE", "MA_NO_GENERATION", "MA_NO_NULL"],
    "cflags_cc": ["-std=c++17"],
    "conditions": [
      ["OS=='linux'", {"libraries": ["-ldl", "-lpthread", "-lm"]}],
      ["OS=='mac'", {"xcode_settings": {"CLANG_CXX_LANGUAGE_STANDARD": "c++17"}, "libraries": ["-framework CoreAudio", "-framework AudioToolbox", "-framework CoreFoundation"]}],
      ["OS=='win'", {"msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/std:c++17"]}}, "libraries": ["ole32.lib", "uuid.lib"]}]
    ]
  }]
}
