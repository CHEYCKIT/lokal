#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

class WasapiSharedOutput {
public:
  WasapiSharedOutput();
  ~WasapiSharedOutput();

  WasapiSharedOutput(const WasapiSharedOutput&) = delete;
  WasapiSharedOutput& operator=(const WasapiSharedOutput&) = delete;

  bool open(const std::wstring& endpointId, uint32_t sampleRate, uint32_t bits,
            std::string& error);
  bool start(std::string& error);
  bool pause(std::string& error);
  bool write(const void* pcm, size_t size, std::string& error);
  void close();

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
