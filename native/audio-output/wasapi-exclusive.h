#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

class WasapiExclusiveOutput {
public:
  WasapiExclusiveOutput();
  ~WasapiExclusiveOutput();

  WasapiExclusiveOutput(const WasapiExclusiveOutput&) = delete;
  WasapiExclusiveOutput& operator=(const WasapiExclusiveOutput&) = delete;

  bool open(const std::wstring& endpointId, uint32_t sampleRate, uint32_t bits, std::string& error);
  bool start(std::string& error);
  bool write(const void* pcm, size_t size, std::string& error);
  void clear();
  void discard();
  void close();
  bool isOpen() const;
  bool isRunning() const;
  bool discardComplete() const;
  uint64_t discardedFrames() const;
  uint32_t sampleRate() const;
  double streamTime() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
