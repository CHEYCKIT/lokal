@echo off
setlocal

if "%JAVA_HOME%"=="" (
  echo Set JAVA_HOME to a JDK 17 installation before building the JNI library.
  exit /b 1
)

set "VSINSTALL="
for %%Y in (2022 2019 2017) do (
  for %%E in (BuildTools Community Professional Enterprise) do (
    if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\%%Y\%%E\VC\Auxiliary\Build\vcvars64.bat" set "VSINSTALL=%ProgramFiles(x86)%\Microsoft Visual Studio\%%Y\%%E"
  )
)
if "%VSINSTALL%"=="" (
  echo Visual Studio Build Tools were not found.
  exit /b 1
)
if not exist "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" (
  echo Install the Visual C++ x64 build tools to compile the JNI library.
  exit /b 1
)

set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"
call "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1

if not exist "%~dp0build\native" mkdir "%~dp0build\native"
pushd "%~dp0build\native"
cl /nologo /std:c++17 /EHsc /MD /LD ^
  /I"%JAVA_HOME%\include" /I"%JAVA_HOME%\include\win32" ^
  /I"%~dp0..\..\native\audio-output" ^
  "%~dp0src\main\cpp\wasapi_jni.cpp" ^
  "%~dp0..\..\native\audio-output\wasapi-exclusive.cc" ^
  /link /IMPLIB:"%~dp0build\native\lokal_wasapi.lib" /OUT:"%~dp0build\native\lokal_wasapi.dll" ole32.lib avrt.lib uuid.lib
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo Built %~dp0build\native\lokal_wasapi.dll
