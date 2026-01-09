@echo off
chcp 65001 >nul
echo ========================================
echo 配置 Windows 防火墙规则
echo ========================================
echo.
echo 正在添加防火墙规则，允许端口 3000 的入站连接...
echo.

netsh advfirewall firewall delete rule name="Node.js Server Port 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Node.js Server Port 3000" dir=in action=allow protocol=TCP localport=3000

if %errorlevel% equ 0 (
    echo ✓ 防火墙规则添加成功！
    echo.
    echo 现在可以运行: npm run start:lan
    echo.
) else (
    echo ✗ 防火墙规则添加失败，请以管理员身份运行此脚本
    echo.
    echo 右键点击此文件，选择"以管理员身份运行"
    echo.
)

pause

